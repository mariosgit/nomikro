// Tone.js engine (https://tonejs.github.io): ready-made synths. Loaded on demand (dynamic import, ~340 kB),
// runs on our AudioContext (setContext), so its times are the same AudioContext seconds as everywhere else.
// We only use Tone's instruments, not its Transport: timing comes from src/engine/clock.ts.
import { DRIVE, DRUM_ROLES, driveStage, drumParams, drumValues, midiToHz, resolve, semis, type DrumKit, type DrumValues, type Melodic, type ParamDef, type Params, type Voice } from './types';

type ToneLib = typeof import('tone');

let lib: Promise<ToneLib> | null = null;

/** Loads Tone.js once and points it at our AudioContext. */
export function loadTone(ctx: AudioContext): Promise<ToneLib> {
    return (lib ??= import('tone').then((Tone) => {
        Tone.setContext(ctx);
        return Tone;
    }));
}

/** Tone throws on some timing edge cases (e.g. two attacks at the same time on a mono synth): never break the sequencer. */
function safe(fn: () => void): void {
    try {
        fn();
    } catch (error) {
        console.warn('tone:', error);
    }
}

/** dB for a level factor (Tone volumes are in dB). */
const db = (level: number) => 20 * Math.log10(Math.max(0.001, level));
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const TONE_DRUM_PARAMS = drumParams();

/**
 * Drum kit from Tone's drum synths: MembraneSynth (kick, toms), NoiseSynth (snare, clap), MetalSynth (hats, cowbell).
 * Per drum sound: Tune, Decay, Tone (kick / toms: pitch sweep, snare / clap: filter, hats / cowbell: metal color), Level.
 * No live set(): the mixer rebuilds the kit on changes.
 */
export async function toneDrums(ctx: AudioContext, out: AudioNode, params: Params): Promise<DrumKit> {
    const T = await loadTone(ctx);
    const [kv, sv, chv, ohv, clv, ltv, htv, cbv] = DRUM_ROLES.map((_, i) => drumValues(params, i));

    const kickHz = 32.7 * semis(kv.tune); // C1
    const kick = new T.MembraneSynth({
        pitchDecay: 0.05,
        octaves: clampN(6 * kv.tone, 1, 10),
        envelope: { attack: 0.001, decay: 0.4 * kv.decay, sustain: 0 },
        volume: -1 + db(kv.level),
    });
    const snareHp = new T.Filter(clampN(1500 * sv.tone, 200, 12000), 'highpass');
    const snare = new T.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18 * sv.decay, sustain: 0 }, volume: -7 + db(sv.level) });
    const snareBodyHz = 98 * semis(sv.tune); // G2
    const snareBody = new T.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.1 * sv.decay, sustain: 0 }, volume: -11 + db(sv.level) });
    const hat = (v: DrumValues, decay: number) =>
        new T.MetalSynth({
            envelope: { attack: 0.001, decay: decay * v.decay, release: 0.01 },
            harmonicity: 5.1,
            modulationIndex: 32,
            resonance: clampN(4000 * v.tone, 500, 12000),
            octaves: 1.5,
            volume: -23 + db(v.level),
        });
    const closedHat = hat(chv, 0.05);
    const openHat = hat(ohv, 0.4);
    const clapBp = new T.Filter(clampN(1200 * clv.tone * semis(clv.tune), 200, 10000), 'bandpass');
    const clap = new T.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.005, decay: 0.15 * clv.decay, sustain: 0 }, volume: -5 + db(clv.level) });
    const tom = (v: DrumValues, decay: number) =>
        new T.MembraneSynth({ pitchDecay: 0.08, octaves: clampN(2 * v.tone, 0.5, 8), envelope: { attack: 0.001, decay: decay * v.decay, sustain: 0 }, volume: -5 + db(v.level) });
    const lowTom = tom(ltv, 0.35);
    const highTom = tom(htv, 0.28);
    const cowbell = new T.MetalSynth({
        envelope: { attack: 0.001, decay: 0.25 * cbv.decay, release: 0.05 },
        harmonicity: 1.4,
        modulationIndex: 2,
        resonance: clampN(800 * cbv.tone, 200, 8000),
        octaves: 0.5,
        volume: -21 + db(cbv.level),
    });

    snare.connect(snareHp);
    clap.connect(clapBp);
    // each drum sound through its own drive stage
    const values = [kv, sv, chv, ohv, clv, ltv, htv, cbv];
    const stages = values.map((v) => driveStage(ctx, out, v.drive));
    const outputs = [kick, snareHp, snareBody, closedHat, openHat, clapBp, lowTom, highTom, cowbell];
    const soundOf = [0, 1, 1, 2, 3, 4, 5, 6, 7];
    outputs.forEach((node, i) => node.connect(stages[soundOf[i]].input));
    const all = [...outputs, snare, clap];

    return {
        trigger(sound, t, velocity) {
            const v = 0.3 + 0.7 * velocity;
            safe(() => {
                switch (sound) {
                    case 0: return kick.triggerAttackRelease(kickHz, 0.3, t, v);
                    case 1:
                        snare.triggerAttackRelease(0.15, t, v);
                        return snareBody.triggerAttackRelease(snareBodyHz, 0.08, t, v);
                    case 2: return closedHat.triggerAttackRelease(400 * semis(chv.tune), 0.05, t, v);
                    case 3: return openHat.triggerAttackRelease(400 * semis(ohv.tune), 0.4, t, v);
                    case 4: return clap.triggerAttackRelease(0.12, t, v);
                    case 5: return lowTom.triggerAttackRelease(49 * semis(ltv.tune), 0.3, t, v); // G1
                    case 6: return highTom.triggerAttackRelease(73.4 * semis(htv.tune), 0.25, t, v); // D2
                    case 7: return cowbell.triggerAttackRelease(560 * semis(cbv.tune), 0.2, t, v);
                }
            });
        },
        dispose() {
            for (const node of all) node.dispose();
            for (const stage of stages) stage.dispose();
        },
    };
}

type ToneSynth = {
    set(options: object): unknown;
    triggerAttack(note: number, time: number, velocity: number): unknown;
    triggerAttackRelease(note: number, duration: number, time: number, velocity: number): unknown;
    connect(out: AudioNode): unknown;
    dispose(): unknown;
};

/** Wraps a mono synth (release releases whatever plays) or a PolySynth (release releases that note). */
function melodic(synth: ToneSynth, release: (hz: number, t: number) => void, options: (p: Params) => object): Melodic {
    return {
        set(params) {
            safe(() => synth.set(options(params)));
        },
        note(midi, t, velocity, duration): Voice {
            const hz = midiToHz(midi);
            const v = 0.3 + 0.7 * velocity;
            if (duration !== undefined) {
                safe(() => synth.triggerAttackRelease(hz, duration, t, v));
                return { release() {} };
            }
            safe(() => synth.triggerAttack(hz, t, v));
            let released = false;
            return {
                release(at) {
                    if (released) return;
                    released = true;
                    safe(() => release(hz, Math.max(at ?? 0, t + 0.01)));
                },
            };
        },
        dispose() {
            synth.dispose();
        },
    };
}

const MONO_WAVES = ['sawtooth', 'square', 'triangle', 'pulse', 'pwm', 'fatsawtooth', 'fatsquare', 'fmsquare', 'amsawtooth', 'fmsawtooth'] as const;
const MONO_WAVE_NAMES = ['saw', 'square', 'triangle', 'pulse', 'pwm', 'fat saw', 'fat square', 'fm square', 'am saw', 'fm saw'];

export const TONE_MONO_PARAMS: readonly ParamDef[] = [
    { id: 'wave', name: 'Wave', min: 0, max: MONO_WAVES.length - 1, default: 0, options: MONO_WAVE_NAMES },
    { id: 'cutoff', name: 'Cutoff', min: 40, max: 3000, default: 200, unit: 'Hz', log: true, random: [120, 1500] },
    { id: 'res', name: 'Resonance', min: 0.5, max: 12, default: 3, random: [0.5, 9] },
    { id: 'env', name: 'Env amount', min: 0, max: 7, default: 3.5, random: [1.5, 6] },
    { id: 'decay', name: 'Decay', min: 0.03, max: 1.5, default: 0.25, unit: 's', log: true, random: [0.08, 0.7] },
    { id: 'sustain', name: 'Sustain', min: 0, max: 1, default: 0.5, unit: '%', random: [0.2, 0.9] },
    { id: 'glide', name: 'Glide', min: 0, max: 0.2, default: 0, unit: 's', random: [0, 0.06] },
    DRIVE,
];

/** Classic mono lead: saw → resonant low-pass with filter envelope. */
export async function toneMono(ctx: AudioContext, out: AudioNode, params: Params): Promise<Melodic> {
    const T = await loadTone(ctx);
    const options = (raw: Params) => {
        const p = resolve(TONE_MONO_PARAMS, raw);
        return {
            // Tone's oscillator type union is too wide for its option types: cast (all are valid OmniOscillator types)
            oscillator: { type: MONO_WAVES[p.wave] as 'sawtooth' },
            filter: { Q: p.res, type: 'lowpass' as const },
            // short attacks: a sequenced note lasts ~0.85 step (≈ 115 ms at 110 BPM), slow attacks never open up
            envelope: { attack: 0.005, decay: p.decay, sustain: p.sustain, release: 0.2 },
            filterEnvelope: { attack: 0.005, decay: p.decay, sustain: 0.3, release: 0.3, baseFrequency: p.cutoff, octaves: p.env },
            portamento: p.glide,
        };
    };
    const synth = new T.MonoSynth({ ...options(params), volume: -9 });
    synth.connect(out);
    return melodic(synth as unknown as ToneSynth, (_hz, t) => synth.triggerRelease(t), options);
}

const FM_WAVES = ['sine', 'triangle', 'square', 'sawtooth'] as const;

export const TONE_FM_PARAMS: readonly ParamDef[] = [
    { id: 'ratio', name: 'Ratio', min: 0.25, max: 8, default: 3, log: true, random: [0.5, 8] },
    { id: 'index', name: 'FM amount', min: 0, max: 40, default: 10, random: [1, 30] },
    { id: 'wave', name: 'Wave', min: 0, max: 3, default: 0, options: FM_WAVES },
    { id: 'modWave', name: 'Mod wave', min: 0, max: 3, default: 0, options: FM_WAVES },
    { id: 'attack', name: 'Attack', min: 0.001, max: 1, default: 0.01, unit: 's', log: true, random: [0.001, 0.05] },
    { id: 'decay', name: 'Decay', min: 0.05, max: 2, default: 0.3, unit: 's', log: true, random: [0.1, 0.9] },
    { id: 'sustain', name: 'Sustain', min: 0, max: 1, default: 0.4, unit: '%', random: [0.2, 0.8] },
    { id: 'release', name: 'Release', min: 0.05, max: 3, default: 0.6, unit: 's', log: true, random: [0.2, 1.5] },
    DRIVE,
];

/** FM bells / e-piano-ish, polyphonic. */
export async function toneFm(ctx: AudioContext, out: AudioNode, params: Params): Promise<Melodic> {
    const T = await loadTone(ctx);
    const options = (raw: Params) => {
        const p = resolve(TONE_FM_PARAMS, raw);
        return {
            harmonicity: p.ratio, // frequency ratio modulator : carrier
            modulationIndex: p.index,
            oscillator: { type: FM_WAVES[p.wave] },
            modulation: { type: FM_WAVES[p.modWave] },
            envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
            modulationEnvelope: { attack: 0.01, decay: p.decay * 0.7, sustain: 0.3, release: 0.4 },
        };
    };
    const synth = new T.PolySynth(T.FMSynth, { ...options(params), volume: -13 });
    synth.connect(out);
    return melodic(synth as unknown as ToneSynth, (hz, t) => synth.triggerRelease(hz, t), options);
}

const PAD_WAVES = ['fatsawtooth', 'fatsquare', 'fattriangle'] as const;

export const TONE_PAD_PARAMS: readonly ParamDef[] = [
    { id: 'wave', name: 'Wave', min: 0, max: 2, default: 0, options: ['saw', 'square', 'triangle'] },
    { id: 'voices', name: 'Voices', min: 1, max: 6, default: 3, int: true, random: [2, 6] },
    { id: 'detune', name: 'Detune', min: 0, max: 100, default: 30, random: [10, 80] },
    { id: 'attack', name: 'Attack', min: 0.005, max: 2, default: 0.04, unit: 's', log: true, random: [0.005, 0.3] },
    { id: 'decay', name: 'Decay', min: 0.05, max: 2, default: 0.3, unit: 's', log: true, random: [0.1, 0.8] },
    { id: 'sustain', name: 'Sustain', min: 0, max: 1, default: 0.6, unit: '%', random: [0.4, 0.9] },
    { id: 'release', name: 'Release', min: 0.05, max: 4, default: 0.8, unit: 's', log: true, random: [0.3, 2] },
    DRIVE,
];

/** Detuned super-saw pad, polyphonic (also meant for a chords track). */
export async function tonePad(ctx: AudioContext, out: AudioNode, params: Params): Promise<Melodic> {
    const T = await loadTone(ctx);
    const options = (raw: Params) => {
        const p = resolve(TONE_PAD_PARAMS, raw);
        return {
            oscillator: { type: PAD_WAVES[p.wave], count: p.voices, spread: p.detune },
            envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
        };
    };
    const synth = new T.PolySynth(T.Synth, { ...options(params), volume: -17 });
    synth.connect(out);
    return melodic(synth as unknown as ToneSynth, (hz, t) => synth.triggerRelease(hz, t), options);
}
