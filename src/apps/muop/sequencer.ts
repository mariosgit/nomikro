// μOp sequencer: plays the song's pattern chain on the clock, records live hits quantized to the nearest step.
import { Clock } from '../../engine/clock';
import { toAudioTime } from '../../engine/audio';
import { DRUMS, STEPS, degreeToMidi, type Song } from './model';
import type { Synth } from './sounds';

export interface PlayedStep {
    /** performance.now() ms */
    time: number;
    pattern: number;
    step: number;
    /** Drum sounds triggered on this step. */
    drums: number[];
    /** Melody degree played, null = rest. */
    note: number | null;
}

type Target = { track: 'drums'; sound: number } | { track: 'melody' };

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
        private synth: Synth,
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
        const p = this.song.patterns[pattern];
        if (target.track === 'drums') p.drums[target.sound][step] = value;
        else p.melody[step] = value;
        return { pattern, step };
    }

    private play(index: number, time: number, duration: number): void {
        const step = index % STEPS;
        if (step === 0 && index !== this.clock.startIndex) this.advanceChain();
        this.nextStep = (step + 1) % STEPS;
        const pattern = this.pattern;
        const p = this.song.patterns[pattern];
        const t = toAudioTime(time);

        const drums: number[] = [];
        for (let sound = 0; sound < DRUMS; sound++) {
            const v = p.drums[sound][step];
            if (v > 0 && !this.skip.delete(this.key(pattern, step, { track: 'drums', sound }))) {
                this.synth.drum(sound, t, v);
                drums.push(sound);
            }
        }
        let note = p.melody[step];
        if (note !== null && this.skip.delete(this.key(pattern, step, { track: 'melody' }))) note = null;
        if (note !== null) this.synth.note(degreeToMidi(note), t, 0.8, (duration * 0.85) / 1000);

        this.recent.push({ time, pattern, step, duration });
        if (this.recent.length > 8) this.recent.shift();
        for (const l of this.listeners) l({ time, pattern, step, drums, note });
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
        return `${pattern}:${step}:${target.track === 'drums' ? target.sound : 'm'}`;
    }
}
