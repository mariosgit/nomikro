// "Basic" engine: plain Web Audio nodes, no library, no samples.
import { chooser, midiToHz, type DrumKit, type Melodic, type Voice } from './types';

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBuffer {
    if (noiseBuffer?.sampleRate === ctx.sampleRate) return noiseBuffer;
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
}

/** Synthesized drums: pitch-swept sines (kick, toms), filtered noise (snare, hats, clap), square pair (cowbell). */
export class BasicDrums implements DrumKit {
    /** Random variation: pitch / decay / filter scale factors (1 = default). */
    private pitch: number;
    private decay: number;
    private bright: number;

    constructor(
        private ctx: AudioContext,
        private out: AudioNode,
        random = false,
    ) {
        const { num } = chooser(random);
        this.pitch = num(1, 0.6, 1.6);
        this.decay = num(1, 0.5, 2);
        this.bright = num(1, 0.5, 1.8);
    }

    trigger(sound: number, t: number, velocity: number): void {
        const g = 0.25 + 0.75 * velocity;
        const p = this.pitch;
        const d = this.decay;
        const b = this.bright;
        switch (sound) {
            case 0: return this.tone('sine', t, g, 160 * p, 45 * p, 0.12, 0.45 * d);
            case 1:
                this.noiseHit(t, g * 0.7, 0.18 * d, { type: 'highpass', frequency: 1200 * b });
                return this.tone('triangle', t, g * 0.5, 190 * p, 160 * p, 0.05, 0.1 * d);
            case 2: return this.noiseHit(t, g * 0.35, 0.05 * d, { type: 'highpass', frequency: Math.min(12000, 7000 * b) });
            case 3: return this.noiseHit(t, g * 0.3, 0.35 * d, { type: 'highpass', frequency: Math.min(12000, 7000 * b) });
            case 4: return this.clap(t, g * 0.8);
            case 5: return this.tone('sine', t, g * 0.8, 110 * p, 70 * p, 0.3, 0.35 * d);
            case 6: return this.tone('sine', t, g * 0.7, 180 * p, 120 * p, 0.25, 0.28 * d);
            case 7: return this.cowbell(t, g * 0.25);
        }
    }

    dispose(): void {}

    /** Pitched hit: frequency sweep f0 → f1 in `sweep` s, decay to silence in `decay` s. */
    private tone(type: OscillatorType, t: number, g: number, f0: number, f1: number, sweep: number, decay: number): void {
        const osc = new OscillatorNode(this.ctx, { type, frequency: f0 });
        const amp = new GainNode(this.ctx, { gain: 0 });
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(f1, t + sweep);
        amp.gain.setValueAtTime(g, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + decay);
        osc.connect(amp).connect(this.out);
        osc.start(t);
        osc.stop(t + decay + 0.05);
    }

    private noiseHit(t: number, g: number, decay: number, filter: BiquadFilterOptions): void {
        const src = new AudioBufferSourceNode(this.ctx, { buffer: noise(this.ctx) });
        const amp = new GainNode(this.ctx, { gain: 0 });
        amp.gain.setValueAtTime(g, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + decay);
        src.connect(new BiquadFilterNode(this.ctx, filter)).connect(amp).connect(this.out);
        src.start(t, Math.random() * 0.5);
        src.stop(t + decay + 0.05);
    }

    private clap(t: number, g: number): void {
        const src = new AudioBufferSourceNode(this.ctx, { buffer: noise(this.ctx) });
        const amp = new GainNode(this.ctx, { gain: 0 });
        for (let k = 0; k < 3; k++) {
            amp.gain.setValueAtTime(g, t + k * 0.012);
            amp.gain.linearRampToValueAtTime(g * 0.15, t + k * 0.012 + 0.01);
        }
        amp.gain.setValueAtTime(g, t + 0.036);
        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        src.connect(new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: 1200, Q: 1 })).connect(amp).connect(this.out);
        src.start(t, Math.random() * 0.5);
        src.stop(t + 0.3);
    }

    private cowbell(t: number, g: number): void {
        const band = new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: 800, Q: 2 });
        const amp = new GainNode(this.ctx, { gain: 0 });
        amp.gain.setValueAtTime(g, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        band.connect(amp).connect(this.out);
        for (const f of [540, 800]) {
            const osc = new OscillatorNode(this.ctx, { type: 'square', frequency: f });
            osc.connect(band);
            osc.start(t);
            osc.stop(t + 0.3);
        }
    }
}

/** Lead: saw + square sub octave → resonant low-pass with a pluck envelope. One voice per note. */
export class BasicLead implements Melodic {
    private wave: OscillatorType;
    private sub: number;
    private q: number;
    private env: number;
    private sustain: number;

    constructor(
        private ctx: AudioContext,
        private out: AudioNode,
        random = false,
    ) {
        const { num, pick } = chooser(random);
        this.wave = pick<OscillatorType>('sawtooth', ['sawtooth', 'square', 'triangle']);
        this.sub = num(0.3, 0, 0.7);
        this.q = num(6, 1, 14);
        this.env = num(4000, 2000, 8000);
        this.sustain = num(0.6, 0.4, 0.9);
    }

    note(midi: number, t: number, velocity: number, duration?: number): Voice {
        const c = this.ctx;
        const hz = midiToHz(midi);
        const g = 0.12 + 0.13 * velocity;
        const osc = new OscillatorNode(c, { type: this.wave, frequency: hz });
        const sub = new OscillatorNode(c, { type: 'square', frequency: hz / 2 });
        const subGain = new GainNode(c, { gain: this.sub });
        const filter = new BiquadFilterNode(c, { type: 'lowpass', Q: this.q, frequency: 300 });
        const amp = new GainNode(c, { gain: 0 });
        filter.frequency.setValueAtTime(300, t);
        filter.frequency.linearRampToValueAtTime(600 + this.env * velocity, t + 0.005);
        filter.frequency.setTargetAtTime(500, t + 0.005, 0.12);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(g, t + 0.005);
        amp.gain.setTargetAtTime(g * this.sustain, t + 0.005, 0.1);
        osc.connect(filter);
        sub.connect(subGain).connect(filter);
        filter.connect(amp).connect(this.out);
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

    dispose(): void {}
}
