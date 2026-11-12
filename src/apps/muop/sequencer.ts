// μOp sequencer: plays the song's pattern chain on the clock, records live hits quantized to the nearest step.
import { Clock } from '../../engine/clock';
import { toAudioTime } from '../../engine/audio';
import { DRUMS, STEPS, chordNotes, degreeToMidi, type Song } from './model';
import type { Sounds } from './sounds';

export interface PlayedStep {
    /** performance.now() ms */
    time: number;
    pattern: number;
    step: number;
    /** Per track: the pads that played (drum sounds / note degrees / chord numbers), for flashing them. */
    pads: number[][];
}

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
    }

    /** Stops and rewinds to the first step of the chain. */
    stop(): void {
        this.clock.stop();
        this.nextStep = 0;
        this.chainPos = 0;
        this.applyPendingChain();
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
        const p = this.song.patterns[pattern];
        const t = toAudioTime(time);

        const length = (duration * 0.85) / 1000;
        const pads = this.song.tracks.map((track, i): number[] => {
            const steps = p.tracks[i];
            if (track.kind === 'drums') {
                const hit: number[] = [];
                for (let sound = 0; sound < DRUMS; sound++) {
                    const v = steps.drums[sound][step];
                    if (v > 0 && !this.skip.delete(this.key(pattern, step, { track: i, sound }))) {
                        this.sounds.drum(i, sound, t, v);
                        hit.push(sound);
                    }
                }
                return hit;
            }
            const n = steps.notes[step];
            if (track.kind === null || n === null || this.skip.delete(this.key(pattern, step, { track: i }))) return [];
            const midis = track.kind === 'chords' ? chordNotes(n, track.octave) : [degreeToMidi(n, track.octave)];
            for (const midi of midis) this.sounds.note(i, midi, t, 0.8, length);
            return [n];
        });

        this.recent.push({ time, pattern, step, duration });
        if (this.recent.length > 8) this.recent.shift();
        for (const l of this.listeners) l({ time, pattern, step, pads });
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
