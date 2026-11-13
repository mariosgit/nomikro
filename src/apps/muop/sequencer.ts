// μOp sequencer: plays the song's pattern chain on the clock, records live hits quantized to the nearest step.
import { Clock } from '../../engine/clock';
import { toAudioTime } from '../../engine/audio';
import { DRUMS, MAX_LENGTH, STEPS, audible, type FxHit, type Song } from './model';
import { chordAt, harmonyTrack, trackMidis } from './harmony';
import { FX, TrackFx } from './fx';
import type { MasterFxId } from '../../engine/fx';
import type { Sounds } from './sounds';

export interface PlayedStep {
    /** performance.now() ms */
    time: number;
    pattern: number;
    step: number;
    /** Per track: the pads that played (drum sounds / note degrees / chord numbers), for flashing them. */
    pads: number[][];
    /** FX active on this step (recorded + live). */
    fx: FxHit[];
    /** Per track: its current step (0..length-1, own clock rate), for the playhead. */
    positions: number[];
    /** Song position in clock steps (16ths) since the start. */
    tick: number;
}

/** The track's step counter (own rate) at song position `tick` (clock steps). */
const trackPos = (tick: number, rate: number) => Math.floor(tick * rate + 1e-9);

/** How long a note plays, in steps: its length, cut where the next note starts (mono style, wraps at the track length). */
export function soundingLength(notes: (number | null)[], lengths: number[], step: number, trackLength: number): number {
    const length = lengths[step] ?? 1;
    for (let j = 1; j < length; j++) if (notes[(step + j) % trackLength] !== null) return j;
    return length;
}

/** Adds an FX hit to a step's list, once. */
function addFx(hits: FxHit[], hit: FxHit): void {
    if (!hits.some((h) => h.fx === hit.fx && h.track === hit.track)) hits.push({ ...hit });
}

/** Key of a live FX: global "fx", track FX "fx:track". */
export const fxKey = (hit: FxHit) => (hit.track === undefined ? `${hit.fx}` : `${hit.fx}:${hit.track}`);

/** Where a live hit goes: a drum sound of a drums track, or the note row of a notes / chords track. */
export type Target = { track: number; sound?: number };

export class Sequencer {
    readonly clock: Clock;
    /** Position in song.chain of the pattern playing (or to play). */
    chainPos = 0;
    /** Chain to switch to at the next pattern start (set while playing). */
    pendingChain: number[] | null = null;
    /** Step to start / resume from. */
    private nextStep = 0;
    /** Song position in clock steps (16ths) since the start: tracks derive their own step from it (rate, length). */
    private tick = 0;
    /** Recently handed out steps (≤ lookahead ahead), for quantizing live input. */
    private recent: { time: number; pattern: number; tick: number; duration: number }[] = [];
    /** Recorded notes that already sounded live: skip them on their first scheduled play. */
    private skip = new Set<string>();
    /** Punch-in FX held right now (PERFORM + pad), by fxKey(). */
    readonly liveFx = new Map<string, FxHit>();
    /** Write held FX into the pattern (REC on). */
    recordFx = false;
    /** The harmony track's chord on the last scheduled step (null = none), for live pads on following tracks. */
    chord: number | null = null;
    /** Called before the sequencer changes a pattern (recording), for the undo history. */
    onEdit: (pattern: number) => void = () => {};
    /** Running track FX, per track. */
    private trackFx = new Map<number, TrackFx>();
    private listeners = new Set<(s: PlayedStep) => void>();

    constructor(
        private song: Song,
        private sounds: Sounds,
    ) {
        this.clock = new Clock({ bpm: song.bpm, swing: song.swing });
        this.clock.onStep(({ index, time, duration }) => this.play(index, time, duration));
    }

    get playing(): boolean {
        return this.clock.running;
    }

    /** Pattern playing now (or next, when stopped). Edits go here. */
    get pattern(): number {
        return this.song.chain[this.chainPos % this.song.chain.length];
    }

    /** Called ahead of time for every step (use clock.at(step.time, …) for visuals). */
    onStep(listener: (s: PlayedStep) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    start(): void {
        this.clock.bpm = this.song.bpm;
        this.clock.swing = this.song.swing;
        this.recent = [];
        this.clock.start(this.nextStep);
    }

    /** Stops, keeps the position (start() resumes). */
    pause(): void {
        this.clock.stop();
        this.releaseFx();
    }

    /** Stops and rewinds to the first step of the chain. */
    stop(): void {
        this.clock.stop();
        this.releaseFx();
        this.nextStep = 0;
        this.tick = 0;
        this.chainPos = 0;
        this.applyPendingChain();
    }

    /** Plays from step 1 of the current pattern, right now. A queued chain starts instead. Also starts when stopped. */
    restart(): void {
        this.clock.stop();
        this.releaseFx();
        this.applyPendingChain();
        this.nextStep = 0;
        this.tick = 0;
        this.start();
    }

    /** New chain: immediately when stopped, at the next pattern start while playing. */
    setChain(chain: number[]): void {
        if (this.playing) this.pendingChain = [...chain];
        else {
            this.song.chain = [...chain];
            this.chainPos = 0;
            this.nextStep = 0;
            this.tick = 0;
            this.pendingChain = null;
        }
    }

    /**
     * Records a live hit at `time` into the target track's nearest step (its own rate and length).
     * Returns where it went, or null when not playing. If that step hasn't been scheduled yet, its first play is
     * skipped (it already sounded live).
     */
    record(target: Target, time: number, value: number): { pattern: number; step: number } | null {
        if (!this.playing || !this.recent.length) return null;
        const track = this.song.tracks[target.track];
        // position in clock steps (fractional) from the last step handed out at or before `time`
        let r = this.recent[0];
        for (const e of this.recent) if (e.time <= time) r = e;
        const k = Math.max(0, Math.round((r.tick + (time - r.time) / r.duration) * track.rate)); // nearest track step
        const at = Math.floor(k / track.rate + 1e-9); // the clock step it plays on
        const last = this.recent[this.recent.length - 1];
        const pattern =
            at <= last.tick ? this.recent.find((e) => e.tick === at)?.pattern ?? r.pattern
            : Math.floor(at / STEPS) > Math.floor(last.tick / STEPS) ? this.peekNextPattern()
            : last.pattern;
        const step = k % track.length;
        if (at > last.tick) this.skip.add(this.key(pattern, step, target));
        this.onEdit(pattern);
        const t = this.song.patterns[pattern].tracks[target.track];
        if (target.sound !== undefined) t.drums[target.sound][step] = value;
        else {
            t.notes[step] = value;
            t.lengths[step] = 1; // recordLength() sets it on release
        }
        return { pattern, step };
    }

    /** Sets the length of a recorded note from how long its pad was held (ms). */
    recordLength(track: number, at: { pattern: number; step: number }, heldMs: number): number {
        const t = this.song.tracks[track];
        const length = Math.min(MAX_LENGTH, t.length, Math.max(1, Math.round((heldMs * t.rate) / this.clock.stepDuration)));
        this.song.patterns[at.pattern].tracks[track].lengths[at.step] = length;
        return length;
    }

    private play(index: number, time: number, duration: number): void {
        const step = index % STEPS;
        if (step === 0 && index !== this.clock.startIndex) this.advanceChain();
        this.nextStep = (step + 1) % STEPS;
        const tick = this.tick++;
        const pattern = this.pattern;
        const t = toAudioTime(time);

        // punch-in FX: recorded on this step ∪ held live (later entries win for track FX)
        if (this.recordFx && this.liveFx.size) {
            this.onEdit(pattern);
            for (const hit of this.liveFx.values()) addFx(this.song.patterns[pattern].fx[step], hit);
        }
        const active = [...this.song.patterns[pattern].fx[step], ...this.liveFx.values()];
        this.applyFx(active, tick, pattern, t, duration);

        // the current chord: the harmony track (first chords track) at its own step
        const h = harmonyTrack(this.song);
        const ht = this.song.tracks[h];
        this.chord = h < 0 ? null : chordAt(this.song.patterns[pattern], h, ht.length, trackPos(tick, ht.rate) % ht.length);

        const pads = this.song.tracks.map((track, i): number[] => {
            if (track.kind === null || !audible(this.song, i)) return [];
            const played: number[] = [];
            // the track's steps on this clock step: ×2 = two (half a step apart), ÷4 = one every 4th clock step
            const first = Math.ceil(tick * track.rate - 1e-9);
            const end = (tick + 1) * track.rate - 1e-9;
            const stepMs = duration / track.rate;
            for (let k = first; k < end; k++) {
                const src = this.trackFx.get(i)?.source(k) ?? (this.trackFx.has(i) ? null : { pattern, step: k % track.length, hits: 1 });
                if (!src) continue; // half time: silent step
                const steps = this.song.patterns[src.pattern].tracks[i];
                const t0 = t + (k / track.rate - tick) * (duration / 1000);
                const at = (h: number) => t0 + (h * stepMs) / 1000 / src.hits;
                // a note lasts its length in steps (ratchets: short hits)
                const gate = src.hits > 1 ? 0.85 / src.hits : soundingLength(steps.notes, steps.lengths, src.step, track.length) - 0.15;
                const hitLength = (stepMs * gate) / 1000;
                if (track.kind === 'drums') {
                    for (let sound = 0; sound < DRUMS; sound++) {
                        const v = steps.drums[sound][src.step];
                        if (v > 0 && !this.skip.delete(this.key(src.pattern, src.step, { track: i, sound }))) {
                            for (let h = 0; h < src.hits; h++) this.sounds.drum(i, sound, at(h), v);
                            played.push(sound);
                        }
                    }
                    continue;
                }
                const n = steps.notes[src.step];
                if (n === null || this.skip.delete(this.key(src.pattern, src.step, { track: i }))) continue;
                const midis = trackMidis(track, n, this.chord, this.song); // [] = a notes value on a chords track
                if (!midis.length) continue;
                for (let h = 0; h < src.hits; h++) for (const midi of midis) this.sounds.note(i, midi, at(h), 0.8, hitLength);
                played.push(n);
            }
            return played;
        });

        this.recent.push({ time, pattern, tick, duration });
        if (this.recent.length > 8) this.recent.shift();
        const positions = this.song.tracks.map((track) => trackPos(tick, track.rate) % track.length);
        for (const l of this.listeners) l({ time, pattern, step, pads, fx: active, positions, tick });
    }

    /** Engages / releases FX for this step: track FX remap steps, global FX drive the master bus (and the clock). */
    private applyFx(active: FxHit[], tick: number, pattern: number, t: number, duration: number): void {
        const wanted = new Map<number, number>(); // track → fx (the last one wins)
        const globals = new Set<MasterFxId>();
        for (const hit of active) {
            if (hit.track !== undefined) wanted.set(hit.track, hit.fx);
            else if (FX[hit.fx]?.global) globals.add(FX[hit.fx].global!);
        }
        for (const track of [...this.trackFx.keys()]) if (!wanted.has(track)) this.trackFx.delete(track);
        for (const [track, fx] of wanted) {
            if (this.trackFx.get(track)?.fx === fx) continue;
            // track FX run in the track's own steps (rate, length)
            const { rate, length } = this.song.tracks[track];
            const k = trackPos(tick, rate);
            this.trackFx.set(track, new TrackFx(fx, k, pattern, k % length, length));
        }

        const bus = this.sounds.fx;
        for (const def of FX) {
            if (!def.global) continue;
            if (globals.has(def.global)) bus.engage(def.global, t, duration);
            else bus.release(def.global, t);
        }
        bus.step(t, duration, tick);
        // slow down: the tempo sinks step by step, back to the song tempo on release
        this.clock.bpm = bus.isActive('slow') ? Math.max(this.song.bpm * 0.25, this.clock.bpm * 0.8) : this.song.bpm;
    }

    /** Ends all FX now (stop / pause). Recorded FX stay in the pattern. */
    private releaseFx(): void {
        this.trackFx.clear();
        const now = this.sounds.ctx.currentTime;
        for (const def of FX) if (def.global) this.sounds.fx.release(def.global, now);
        this.clock.bpm = this.song.bpm;
    }

    private advanceChain(): void {
        if (this.applyPendingChain()) return;
        this.chainPos = (this.chainPos + 1) % this.song.chain.length;
    }

    private applyPendingChain(): boolean {
        if (!this.pendingChain) return false;
        this.song.chain = this.pendingChain;
        this.pendingChain = null;
        this.chainPos = 0;
        return true;
    }

    /** The pattern that plays after the current one (chain / queued chain). */
    peekNextPattern(): number {
        if (this.pendingChain) return this.pendingChain[0];
        return this.song.chain[(this.chainPos + 1) % this.song.chain.length];
    }

    private key(pattern: number, step: number, target: Target): string {
        return `${pattern}:${step}:${target.track}:${target.sound ?? 'n'}`;
    }
}
