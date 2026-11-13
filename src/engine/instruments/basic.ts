// "Basic" engine: plain Web Audio nodes, no library, no samples.
import { DRIVE, DRUM_ROLES, driveStage, drumParams, drumValues, midiToHz, resolve, semis, type DrumKit, type Melodic, type ParamDef, type Params, type Voice } from './types';

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
    static readonly params = drumParams();
    /** Per drum sound: its drive stage into the output. */
    private stages: ReturnType<typeof driveStage>[];
    /** Where the current hit goes (its drum sound's drive stage). */
    private dest: AudioNode;

    constructor(
        private ctx: AudioContext,
        out: AudioNode,
        private params: Params,
    ) {
        this.stages = DRUM_ROLES.map((_, i) => driveStage(ctx, out, drumValues(params, i).drive));
        this.dest = this.stages[0].input;
    }

    set(params: Params): void {
        this.params = params;
        this.stages.forEach((stage, i) => stage.update(drumValues(params, i).drive));
    }

    trigger(sound: number, t: number, velocity: number): void {
        const v = drumValues(this.params, sound);
        this.dest = this.stages[sound]?.input ?? this.dest;
        const g = (0.25 + 0.75 * velocity) * v.level;
        const p = semis(v.tune);
        const d = v.decay;
        const b = v.tone;
        const hat = Math.min(16000, 7000 * b * p);
        switch (sound) {
            case 0: return this.tone('sine', t, g, 160 * p * b, 45 * p, 0.12, 0.45 * d);
            case 1:
                this.noiseHit(t, g * 0.7, 0.18 * d, { type: 'highpass', frequency: 1200 * b });
                return this.tone('triangle', t, g * 0.5, 190 * p, 160 * p, 0.05, 0.1 * d);
            case 2: return this.noiseHit(t, g * 0.35, 0.05 * d, { type: 'highpass', frequency: hat });
            case 3: return this.noiseHit(t, g * 0.3, 0.35 * d, { type: 'highpass', frequency: hat });
            case 4: return this.clap(t, g * 0.8, 1200 * b * p, d);
            case 5: return this.tone('sine', t, g * 0.8, 110 * p * Math.sqrt(b), 70 * p, 0.3, 0.35 * d);
            case 6: return this.tone('sine', t, g * 0.7, 180 * p * Math.sqrt(b), 120 * p, 0.25, 0.28 * d);
            case 7: return this.cowbell(t, g * 0.25, p, b, d);
        }
    }

    dispose(): void {
        setTimeout(() => this.stages.forEach((s) => s.dispose()), 2000);
    }

    /** Pitched hit: frequency sweep f0 → f1 in `sweep` s, decay to silence in `decay` s. */
    private tone(type: OscillatorType, t: number, g: number, f0: number, f1: number, sweep: number, decay: number): void {
        const osc = new OscillatorNode(this.ctx, { type, frequency: f0 });
        const amp = new GainNode(this.ctx, { gain: 0 });
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(f1, t + sweep);
        amp.gain.setValueAtTime(g, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + decay);
        osc.connect(amp).connect(this.dest);
        osc.start(t);
        osc.stop(t + decay + 0.05);
    }

    private noiseHit(t: number, g: number, decay: number, filter: BiquadFilterOptions): void {
        const src = new AudioBufferSourceNode(this.ctx, { buffer: noise(this.ctx) });
        const amp = new GainNode(this.ctx, { gain: 0 });
        amp.gain.setValueAtTime(g, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + decay);
        src.connect(new BiquadFilterNode(this.ctx, filter)).connect(amp).connect(this.dest);
        src.start(t, Math.random() * 0.5);
        src.stop(t + decay + 0.05);
    }

    private clap(t: number, g: number, hz: number, d: number): void {
        const src = new AudioBufferSourceNode(this.ctx, { buffer: noise(this.ctx) });
        const amp = new GainNode(this.ctx, { gain: 0 });
        for (let k = 0; k < 3; k++) {
            amp.gain.setValueAtTime(g, t + k * 0.012);
            amp.gain.linearRampToValueAtTime(g * 0.15, t + k * 0.012 + 0.01);
        }
        amp.gain.setValueAtTime(g, t + 0.036);
        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.036 + 0.18 * d);
        src.connect(new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: hz, Q: 1 })).connect(amp).connect(this.dest);
        src.start(t, Math.random() * 0.5);
        src.stop(t + 0.1 + 0.18 * d);
    }

    private cowbell(t: number, g: number, p: number, b: number, d: number): void {
        const band = new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: 800 * p * b, Q: 2 });
        const amp = new GainNode(this.ctx, { gain: 0 });
        amp.gain.setValueAtTime(g, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.25 * d);
        band.connect(amp).connect(this.dest);
        for (const f of [540, 800]) {
            const osc = new OscillatorNode(this.ctx, { type: 'square', frequency: f * p });
            osc.connect(band);
            osc.start(t);
            osc.stop(t + 0.05 + 0.25 * d);
        }
    }
}

const LEAD_WAVES: OscillatorType[] = ['sawtooth', 'square', 'triangle'];

/** Lead: saw + square sub octave → resonant low-pass with a pluck envelope. One voice per note. */
export class BasicLead implements Melodic {
    static readonly params: readonly ParamDef[] = [
        { id: 'wave', name: 'Wave', min: 0, max: 2, default: 0, options: ['saw', 'square', 'triangle'] },
        { id: 'sub', name: 'Sub', min: 0, max: 1, default: 0.3, unit: '%', random: [0, 0.7] },
        { id: 'cutoff', name: 'Cutoff', min: 300, max: 12000, default: 4600, unit: 'Hz', log: true, random: [1500, 9000] },
        { id: 'res', name: 'Resonance', min: 0.5, max: 18, default: 6, random: [1, 14] },
        { id: 'decay', name: 'Decay', min: 0.02, max: 1, default: 0.12, unit: 's', log: true, random: [0.04, 0.4] },
        { id: 'sustain', name: 'Sustain', min: 0, max: 1, default: 0.6, unit: '%', random: [0.3, 0.9] },
        { id: 'release', name: 'Release', min: 0.01, max: 1, default: 0.04, unit: 's', log: true, random: [0.02, 0.3] },
        DRIVE,
    ];
    private p: Params;

    constructor(
        private ctx: AudioContext,
        private out: AudioNode,
        params: Params,
    ) {
        this.p = resolve(BasicLead.params, params);
    }

    set(params: Params): void {
        this.p = resolve(BasicLead.params, params);
    }

    note(midi: number, t: number, velocity: number, duration?: number): Voice {
        const c = this.ctx;
        const hz = midiToHz(midi);
        const g = 0.12 + 0.13 * velocity;
        const p = this.p;
        const osc = new OscillatorNode(c, { type: LEAD_WAVES[p.wave], frequency: hz });
        const sub = new OscillatorNode(c, { type: 'square', frequency: hz / 2 });
        const subGain = new GainNode(c, { gain: p.sub });
        const filter = new BiquadFilterNode(c, { type: 'lowpass', Q: p.res, frequency: 300 });
        const amp = new GainNode(c, { gain: 0 });
        filter.frequency.setValueAtTime(300, t);
        filter.frequency.linearRampToValueAtTime(Math.max(400, p.cutoff * (0.4 + 0.6 * velocity)), t + 0.005);
        filter.frequency.setTargetAtTime(Math.min(500, p.cutoff), t + 0.005, p.decay);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(g, t + 0.005);
        amp.gain.setTargetAtTime(g * p.sustain, t + 0.005, 0.1);
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
            amp.gain.setTargetAtTime(0, r, p.release);
            osc.stop(r + p.release * 7);
            sub.stop(r + p.release * 7);
        };
        if (duration !== undefined) release(t + duration);
        return { release };
    }

    dispose(): void {}
}
