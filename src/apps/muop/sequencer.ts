// μOp sequencer: plays the song's pattern chain on the clock, records live hits quantized to the nearest step.
import { Clock } from '../../engine/clock';
import { toAudioTime } from '../../engine/audio';
import { DRUMS, STEPS, chordNotes, degreeToMidi, type FxHit, type Song } from './model';
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
    /** Recently handed out steps (≤ lookahead ahead), for quantizing live input. */
    private recent: { time: number; pattern: number; step: number; duration: number }[] = [];
    /** Recorded notes that already sounded live: skip them on their first scheduled play. */
    private skip = new Set<string>();
    /** Punch-in FX held right now (PERFORM + pad), by fxKey(). */
    readonly liveFx = new Map<string, FxHit>();
    /** Write held FX into the pattern (REC on). */
    recordFx = false;
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
        this.chainPos = 0;
        this.applyPendingChain();
    }

    /** Plays from step 1 of the current pattern, right now. A queued chain starts instead. Also starts when stopped. */
    restart(): void {
        this.clock.stop();
        this.releaseFx();
        this.applyPendingChain();
        this.nextStep = 0;
        this.start();
    }

    /** New chain: immediately when stopped, at the next pattern start while playing. */
    setChain(chain: number[]): void {
        if (this.playing) this.pendingChain = [...chain];
        else {
            this.song.chain = [...chain];
            this.chainPos = 0;
            this.nextStep = 0;
            this.pendingChain = null;
        }
    }

    /**
     * Records a live hit at `time` into the nearest step. Returns where it went, or null when not playing.
     * If the step hasn't been scheduled yet, its first play is skipped (it already sounded live).
     */
    record(target: Target, time: number, value: number): { pattern: number; step: number } | null {
        if (!this.playing || !this.recent.length) return null;
        let best = this.recent[0];
        for (const r of this.recent) if (Math.abs(r.time - time) < Math.abs(best.time - time)) best = r;
        let { pattern, step } = best;
        const last = this.recent[this.recent.length - 1];
        if (best === last && time > last.time + last.duration / 2) {
            // closer to the next step, which isn't scheduled yet
            step = (last.step + 1) % STEPS;
            if (step === 0) pattern = this.peekNextPattern();
            this.skip.add(this.key(pattern, step, target));
        }
        this.onEdit(pattern);
        const t = this.song.patterns[pattern].tracks[target.track];
        if (target.sound !== undefined) t.drums[target.sound][step] = value;
        else t.notes[step] = value;
        return { pattern, step };
    }

    private play(index: number, time: number, duration: number): void {
        const step = index % STEPS;
        if (step === 0 && index !== this.clock.startIndex) this.advanceChain();
        this.nextStep = (step + 1) % STEPS;
        const pattern = this.pattern;
        const t = toAudioTime(time);

        // punch-in FX (the pattern is looked up after onEdit: an undo snapshot replaces the object): recorded on this step ∪ held live (later entries win for track FX)
        if (this.recordFx && this.liveFx.size) {
            this.onEdit(pattern);
            for (const hit of this.liveFx.values()) addFx(this.song.patterns[pattern].fx[step], hit);
        }
        const active = [...this.song.patterns[pattern].fx[step], ...this.liveFx.values()];
        this.applyFx(active, index, pattern, step, t, duration);

        const length = (duration * 0.85) / 1000;
        const pads = this.song.tracks.map((track, i): number[] => {
            if (track.kind === null) return [];
            const src = this.trackFx.get(i)?.source(index) ?? (this.trackFx.has(i) ? null : { pattern, step, hits: 1 });
            if (!src) return []; // half time: silent step
            const steps = this.song.patterns[src.pattern].tracks[i];
            const hitLength = length / src.hits;
            const at = (h: number) => t + (h * duration) / 1000 / src.hits;
            if (track.kind === 'drums') {
                const hit: number[] = [];
                for (let sound = 0; sound < DRUMS; sound++) {
                    const v = steps.drums[sound][src.step];
                    if (v > 0 && !this.skip.delete(this.key(src.pattern, src.step, { track: i, sound }))) {
                        for (let h = 0; h < src.hits; h++) this.sounds.drum(i, sound, at(h), v);
                        hit.push(sound);
                    }
                }
                return hit;
            }
            const n = steps.notes[src.step];
            if (n === null || this.skip.delete(this.key(src.pattern, src.step, { track: i }))) return [];
            const midis = track.kind === 'chords' ? chordNotes(n, track.octave) : [degreeToMidi(n, track.octave)];
            for (let h = 0; h < src.hits; h++) for (const midi of midis) this.sounds.note(i, midi, at(h), 0.8, hitLength);
            return [n];
        });

        this.recent.push({ time, pattern, step, duration });
        if (this.recent.length > 8) this.recent.shift();
        for (const l of this.listeners) l({ time, pattern, step, pads, fx: active });
    }

    /** Engages / releases FX for this step: track FX remap steps, global FX drive the master bus (and the clock). */
    private applyFx(active: FxHit[], index: number, pattern: number, step: number, t: number, duration: number): void {
        const wanted = new Map<number, number>(); // track → fx (the last one wins)
        const globals = new Set<MasterFxId>();
        for (const hit of active) {
            if (hit.track !== undefined) wanted.set(hit.track, hit.fx);
            else if (FX[hit.fx]?.global) globals.add(FX[hit.fx].global!);
        }
        for (const track of [...this.trackFx.keys()]) if (!wanted.has(track)) this.trackFx.delete(track);
        for (const [track, fx] of wanted) {
            if (this.trackFx.get(track)?.fx !== fx) this.trackFx.set(track, new TrackFx(fx, index, pattern, step));
        }

        const bus = this.sounds.fx;
        for (const def of FX) {
            if (!def.global) continue;
            if (globals.has(def.global)) bus.engage(def.global, t, duration);
            else bus.release(def.global, t);
        }
        bus.step(t, duration, index);
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

    private peekNextPattern(): number {
        if (this.pendingChain) return this.pendingChain[0];
        return this.song.chain[(this.chainPos + 1) % this.song.chain.length];
    }

    private key(pattern: number, step: number, target: Target): string {
        return `${pattern}:${step}:${target.track}:${target.sound ?? 'n'}`;
    }
}
