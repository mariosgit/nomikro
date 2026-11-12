// μOp sounds: 8 synthesized drums + a lead synth, Web Audio only (no samples).
// Signal chain: voices → low-pass (touch strip) → master gain (volume) → speakers.
import type { Color } from '../../maschine';

export const DRUM_SOUNDS: readonly { name: string; color: Color }[] = [
    { name: 'Kick', color: 'red' },
    { name: 'Snare', color: 'orange' },
    { name: 'Closed hat', color: 'yellow' },
    { name: 'Open hat', color: 'lime' },
    { name: 'Clap', color: 'cyan' },
    { name: 'Low tom', color: 'blue' },
    { name: 'High tom', color: 'violet' },
    { name: 'Cowbell', color: 'magenta' },
];

export interface Voice {
    /** Starts the release at audio time t (default: now). */
    release(t?: number): void;
}

const OPEN = 20000;

export class Synth {
    private master: GainNode;
    private filter: BiquadFilterNode;
    private noise: AudioBuffer;

    constructor(readonly ctx: AudioContext) {
        this.filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: OPEN, Q: 4 });
        this.master = new GainNode(ctx, { gain: 0.8 });
        this.filter.connect(this.master).connect(ctx.destination);
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }

    set volume(v: number) {
        this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }

    /** Low-pass cutoff 0..1 (exponential 150 Hz..20 kHz), null = open. */
    setFilter(amount: number | null): void {
        const hz = amount === null ? OPEN : 150 * Math.pow(OPEN / 150, Math.min(1, Math.max(0, amount)));
        this.filter.frequency.setTargetAtTime(hz, this.ctx.currentTime, amount === null ? 0.08 : 0.02);
    }

    dispose(): void {
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
        setTimeout(() => this.master.disconnect(), 200);
    }

    /** Drum sound 0..7 at audio time t, velocity 0..1. */
    drum(sound: number, t: number, velocity: number): void {
        const g = 0.25 + 0.75 * velocity;
        switch (sound) {
            case 0: return this.tone('sine', t, g, 160, 45, 0.12, 0.45);
            case 1:
                this.noiseHit(t, g * 0.7, 0.18, { type: 'highpass', frequency: 1200 });
                return this.tone('triangle', t, g * 0.5, 190, 160, 0.05, 0.1);
            case 2: return this.noiseHit(t, g * 0.35, 0.05, { type: 'highpass', frequency: 7000 });
            case 3: return this.noiseHit(t, g * 0.3, 0.35, { type: 'highpass', frequency: 7000 });
            case 4: return this.clap(t, g * 0.8);
            case 5: return this.tone('sine', t, g * 0.8, 110, 70, 0.3, 0.35);
            case 6: return this.tone('sine', t, g * 0.7, 180, 120, 0.25, 0.28);
            case 7: return this.cowbell(t, g * 0.25);
        }
    }

    /** Lead note at audio time t. With `duration` (s) it releases by itself, otherwise call release(). */
    note(midi: number, t: number, velocity: number, duration?: number): Voice {
        const c = this.ctx;
        const hz = 440 * Math.pow(2, (midi - 69) / 12);
        const g = 0.12 + 0.13 * velocity;
        const osc = new OscillatorNode(c, { type: 'sawtooth', frequency: hz });
        const sub = new OscillatorNode(c, { type: 'square', frequency: hz / 2 });
        const subGain = new GainNode(c, { gain: 0.3 });
        const filter = new BiquadFilterNode(c, { type: 'lowpass', Q: 6, frequency: 300 });
        const amp = new GainNode(c, { gain: 0 });
        filter.frequency.setValueAtTime(300, t);
        filter.frequency.linearRampToValueAtTime(600 + 4000 * velocity, t + 0.005);
        filter.frequency.setTargetAtTime(500, t + 0.005, 0.12);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(g, t + 0.005);
        amp.gain.setTargetAtTime(g * 0.6, t + 0.005, 0.1);
        osc.connect(filter);
        sub.connect(subGain).connect(filter);
        filter.connect(amp).connect(this.filter);
        osc.start(t);
        sub.start(t);

        let released = false;
        const release = (at = c.currentTime) => {
            if (released) return;
            released = true;
            const r = Math.max(at, t + 0.01);
            amp.gain.cancelAndHoldAtTime(r);
            amp.gain.setTargetAtTime(0, r, 0.04);
            osc.stop(r + 0.3);
            sub.stop(r + 0.3);
        };
        if (duration !== undefined) release(t + duration);
        return { release };
    }

    // --- drum building blocks ---

    /** Pitched hit: frequency sweep f0 → f1 in `sweep` s, decay to silence in `decay` s. */
    private tone(type: OscillatorType, t: number, g: number, f0: number, f1: number, sweep: number, decay: number): void {
        const osc = new OscillatorNode(this.ctx, { type, frequency: f0 });
        const amp = new GainNode(this.ctx, { gain: 0 });
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(f1, t + sweep);
        amp.gain.setValueAtTime(g, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + decay);
        osc.connect(amp).connect(this.filter);
        osc.start(t);
        osc.stop(t + decay + 0.05);
    }

    private noiseHit(t: number, g: number, decay: number, filter: BiquadFilterOptions): void {
        const src = new AudioBufferSourceNode(this.ctx, { buffer: this.noise });
        const amp = new GainNode(this.ctx, { gain: 0 });
        amp.gain.setValueAtTime(g, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + decay);
        src.connect(new BiquadFilterNode(this.ctx, filter)).connect(amp).connect(this.filter);
        src.start(t, Math.random() * 0.5);
        src.stop(t + decay + 0.05);
    }

    private clap(t: number, g: number): void {
        const src = new AudioBufferSourceNode(this.ctx, { buffer: this.noise });
        const amp = new GainNode(this.ctx, { gain: 0 });
        for (let k = 0; k < 3; k++) {
            amp.gain.setValueAtTime(g, t + k * 0.012);
            amp.gain.linearRampToValueAtTime(g * 0.15, t + k * 0.012 + 0.01);
        }
        amp.gain.setValueAtTime(g, t + 0.036);
        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        src.connect(new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: 1200, Q: 1 })).connect(amp).connect(this.filter);
        src.start(t, Math.random() * 0.5);
        src.stop(t + 0.3);
    }

    private cowbell(t: number, g: number): void {
        const band = new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: 800, Q: 2 });
        const amp = new GainNode(this.ctx, { gain: 0 });
        amp.gain.setValueAtTime(g, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        band.connect(amp).connect(this.filter);
        for (const f of [540, 800]) {
            const osc = new OscillatorNode(this.ctx, { type: 'square', frequency: f });
            osc.connect(band);
            osc.start(t);
            osc.stop(t + 0.3);
        }
    }
}
