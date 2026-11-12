// Master FX bus for punch-in effects: native Web Audio nodes only, framework-free, reusable by any app.
// Graph (all nodes always present, neutral while off):
//   input → high-pass → low-pass → tape low-pass → crush (dry / waveshaper → 6 dB/oct low-pass wet) → gate → output
//                                                                              gate → echo send → delay ⟲ feedback → output
//                                                                              gate → reverb send → convolver → output
// Times are AudioContext seconds (toAudioTime()), step lengths in ms (the clock's step duration).

export type MasterFxId = 'lowpass' | 'highpass' | 'gate' | 'pump' | 'echo' | 'reverb' | 'crush' | 'slow';

const OPEN = 20000;
const STEPS_PER_BAR = 16;

export class MasterFx {
    readonly input: GainNode;
    readonly output: GainNode;
    private hp: BiquadFilterNode;
    private lp: BiquadFilterNode;
    private tapeLp: BiquadFilterNode;
    private crushDry: GainNode;
    private crushWet: GainNode;
    private gate: GainNode;
    private echoSend: GainNode;
    private delay: DelayNode;
    private reverbSend: GainNode;
    private active = new Set<MasterFxId>();

    constructor(private ctx: AudioContext) {
        const c = ctx;
        this.input = new GainNode(c);
        this.output = new GainNode(c);
        this.hp = new BiquadFilterNode(c, { type: 'highpass', frequency: 10, Q: 0.7 });
        this.lp = new BiquadFilterNode(c, { type: 'lowpass', frequency: OPEN, Q: 0.7 });
        this.tapeLp = new BiquadFilterNode(c, { type: 'lowpass', frequency: OPEN, Q: 0.7 });
        this.crushDry = new GainNode(c, { gain: 1 });
        this.crushWet = new GainNode(c, { gain: 0 });
        const shaper = new WaveShaperNode(c, { curve: crushCurve(6, 3) });
        // one-pole low-pass (6 dB/oct) at 3 kHz: tames the fizz of the quantize steps
        const a = Math.exp((-2 * Math.PI * 3000) / c.sampleRate);
        const crushLp = new IIRFilterNode(c, { feedforward: [1 - a], feedback: [1, -a] });
        this.gate = new GainNode(c, { gain: 1 });

        this.input.connect(this.hp).connect(this.lp).connect(this.tapeLp);
        this.tapeLp.connect(this.crushDry).connect(this.gate);
        this.tapeLp.connect(shaper).connect(crushLp).connect(this.crushWet).connect(this.gate);
        this.gate.connect(this.output);

        this.echoSend = new GainNode(c, { gain: 0 });
        this.delay = new DelayNode(c, { maxDelayTime: 2, delayTime: 0.3 });
        const feedback = new GainNode(c, { gain: 0.45 });
        this.gate.connect(this.echoSend).connect(this.delay).connect(feedback).connect(this.delay);
        this.delay.connect(this.output);

        this.reverbSend = new GainNode(c, { gain: 0 });
        const reverb = new ConvolverNode(c, { buffer: impulse(c, 2.5) });
        this.gate.connect(this.reverbSend).connect(reverb).connect(this.output);
    }

    isActive(id: MasterFxId): boolean {
        return this.active.has(id);
    }

    /** Turns an effect on at audio time t. stepMs: current step length (sweeps last one bar). */
    engage(id: MasterFxId, t: number, stepMs: number): void {
        if (this.active.has(id)) return;
        this.active.add(id);
        const bar = (STEPS_PER_BAR * stepMs) / 1000;
        switch (id) {
            case 'lowpass':
                return sweep(this.lp, t, 18000, 250, bar, 8);
            case 'highpass':
                return sweep(this.hp, t, 20, 2500, bar, 6);
            case 'echo':
                this.delay.delayTime.setValueAtTime((3 * stepMs) / 1000, t);
                return fade(this.echoSend.gain, t, 0.6);
            case 'reverb':
                return fade(this.reverbSend.gain, t, 0.8);
            case 'crush':
                fade(this.crushDry.gain, t, 0);
                return fade(this.crushWet.gain, t, 0.45); // the drive brings it near full scale: about level with the dry mix
            case 'slow':
                return sweep(this.tapeLp, t, OPEN, 400, 1.2, 0.7);
            // gate / pump: automated per step in step()
        }
    }

    /** Turns an effect off at audio time t. Echo / reverb tails ring out. */
    release(id: MasterFxId, t: number): void {
        if (!this.active.delete(id)) return;
        switch (id) {
            case 'lowpass':
                return reset(this.lp, t, OPEN);
            case 'highpass':
                return reset(this.hp, t, 10);
            case 'echo':
                return fade(this.echoSend.gain, t, 0);
            case 'reverb':
                return fade(this.reverbSend.gain, t, 0);
            case 'crush':
                fade(this.crushDry.gain, t, 1);
                return fade(this.crushWet.gain, t, 0);
            case 'slow':
                return reset(this.tapeLp, t, OPEN);
            case 'gate':
            case 'pump':
                if (!this.active.has('gate') && !this.active.has('pump')) {
                    this.gate.gain.cancelScheduledValues(t);
                    this.gate.gain.setTargetAtTime(1, t, 0.005);
                }
        }
    }

    /** Per-step automation (call for every step): gate chops, pump ducks on beats, echo follows the tempo. */
    step(t: number, stepMs: number, index: number): void {
        const d = stepMs / 1000;
        const g = this.gate.gain;
        if (this.active.has('gate')) {
            g.cancelScheduledValues(t);
            g.setTargetAtTime(1, t, 0.002);
            g.setTargetAtTime(0, t + d * 0.5, 0.004);
        } else if (this.active.has('pump') && index % 4 === 0) {
            g.cancelScheduledValues(t);
            g.setValueAtTime(0.15, t);
            g.setTargetAtTime(1, t + 0.01, d * 1.2);
        }
        if (this.active.has('echo')) this.delay.delayTime.setTargetAtTime(3 * d, t, 0.05);
    }

    disconnect(): void {
        this.output.disconnect();
    }
}

/** Exponential frequency sweep from f0 to f1 over `seconds`, with resonance q. */
function sweep(f: BiquadFilterNode, t: number, f0: number, f1: number, seconds: number, q: number): void {
    f.frequency.cancelScheduledValues(t);
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + seconds);
    f.Q.setValueAtTime(q, t);
}

function reset(f: BiquadFilterNode, t: number, frequency: number): void {
    f.frequency.cancelScheduledValues(t);
    f.frequency.setTargetAtTime(frequency, t, 0.03);
    f.Q.setValueAtTime(0.7, t);
}

function fade(p: AudioParam, t: number, value: number): void {
    p.cancelScheduledValues(t);
    p.setTargetAtTime(value, t, 0.01);
}

/** Waveshaper curve: drive (tanh) + amplitude quantized to `levels` steps per polarity. */
function crushCurve(levels: number, drive: number): Float32Array<ArrayBuffer> {
    const curve = new Float32Array(4096);
    for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.round(Math.tanh(x * drive) * levels) / levels;
    }
    return curve;
}

/** Stereo reverb impulse: decaying noise. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.round(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
    return buffer;
}
