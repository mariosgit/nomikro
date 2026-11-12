// Tone.js engine (https://tonejs.github.io): ready-made synths. Loaded on demand (dynamic import, ~340 kB),
// runs on our AudioContext (setContext), so its times are the same AudioContext seconds as everywhere else.
// We only use Tone's instruments, not its Transport: timing comes from src/engine/clock.ts.
import { chooser, midiToHz, type DrumKit, type Melodic, type Voice } from './types';

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

/** Drum kit from Tone's drum synths: MembraneSynth (kick, toms), NoiseSynth (snare, clap), MetalSynth (hats, cowbell). */
export async function toneDrums(ctx: AudioContext, out: AudioNode, random = false): Promise<DrumKit> {
    const T = await loadTone(ctx);
    const { num, pick } = chooser(random);

    const kickNote = pick('C1', ['A0', 'C1', 'D1', 'E1', 'G1']);
    const kick = new T.MembraneSynth({
        pitchDecay: num(0.05, 0.01, 0.12),
        octaves: num(6, 3, 9),
        envelope: { attack: 0.001, decay: num(0.4, 0.2, 0.9), sustain: 0 },
        volume: -1,
    });
    const snareHp = new T.Filter(num(1500, 600, 4000), 'highpass');
    const snare = new T.NoiseSynth({
        noise: { type: pick<'white' | 'pink' | 'brown'>('white', ['white', 'pink']) },
        envelope: { attack: 0.001, decay: num(0.18, 0.08, 0.35), sustain: 0 },
        volume: -7,
    });
    const snareBodyNote = pick('G2', ['D2', 'F2', 'G2', 'A2', 'C3']);
    const snareBody = new T.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: num(0.1, 0.05, 0.2), sustain: 0 }, volume: -11 });
    const hatFreq = num(400, 200, 700);
    const hatParams = { harmonicity: num(5.1, 3, 8), modulationIndex: num(32, 10, 50), resonance: num(4000, 2000, 7000), octaves: num(1.5, 0.8, 2.5) };
    const hat = (decay: number) => new T.MetalSynth({ envelope: { attack: 0.001, decay, release: 0.01 }, ...hatParams, volume: -23 });
    const closedHat = hat(num(0.05, 0.02, 0.1));
    const openHat = hat(num(0.4, 0.2, 0.8));
    const clapBp = new T.Filter(num(1200, 700, 2500), 'bandpass');
    const clap = new T.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.005, decay: num(0.15, 0.08, 0.3), sustain: 0 }, volume: -5 });
    const tomNotes = pick<[string, string]>(['G1', 'D2'], [['E1', 'B1'], ['G1', 'D2'], ['A1', 'E2'], ['C2', 'G2']]);
    const tom = (decay: number) => new T.MembraneSynth({ pitchDecay: num(0.08, 0.03, 0.15), octaves: num(2, 1, 4), envelope: { attack: 0.001, decay, sustain: 0 }, volume: -5 });
    const lowTom = tom(num(0.35, 0.2, 0.6));
    const highTom = tom(num(0.28, 0.15, 0.5));
    const bellFreq = num(560, 350, 900);
    const cowbell = new T.MetalSynth({
        envelope: { attack: 0.001, decay: num(0.25, 0.1, 0.5), release: 0.05 },
        harmonicity: num(1.4, 1, 3),
        modulationIndex: num(2, 1, 8),
        resonance: num(800, 500, 2000),
        octaves: 0.5,
        volume: -21,
    });

    snare.connect(snareHp);
    clap.connect(clapBp);
    const outputs = [kick, snareHp, snareBody, closedHat, openHat, clapBp, lowTom, highTom, cowbell];
    for (const node of outputs) node.connect(out);
    const all = [...outputs, snare, clap];

    return {
        trigger(sound, t, velocity) {
            const v = 0.3 + 0.7 * velocity;
            safe(() => {
                switch (sound) {
                    case 0: return kick.triggerAttackRelease(kickNote, 0.3, t, v);
                    case 1:
                        snare.triggerAttackRelease(0.15, t, v);
                        return snareBody.triggerAttackRelease(snareBodyNote, 0.08, t, v);
                    case 2: return closedHat.triggerAttackRelease(hatFreq, 0.05, t, v);
                    case 3: return openHat.triggerAttackRelease(hatFreq, 0.4, t, v);
                    case 4: return clap.triggerAttackRelease(0.12, t, v);
                    case 5: return lowTom.triggerAttackRelease(tomNotes[0], 0.3, t, v);
                    case 6: return highTom.triggerAttackRelease(tomNotes[1], 0.25, t, v);
                    case 7: return cowbell.triggerAttackRelease(bellFreq, 0.2, t, v);
                }
            });
        },
        dispose() {
            for (const node of all) node.dispose();
        },
    };
}

type ToneSynth = {
    triggerAttack(note: number, time: number, velocity: number): unknown;
    triggerAttackRelease(note: number, duration: number, time: number, velocity: number): unknown;
    connect(out: AudioNode): unknown;
    dispose(): unknown;
};

/** Wraps a mono synth (release releases whatever plays) or a PolySynth (release releases that note). */
function melodic(synth: ToneSynth, release: (hz: number, t: number) => void): Melodic {
    return {
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

const MONO_WAVES = ['sawtooth', 'square', 'triangle', 'pulse', 'pwm', 'fatsawtooth', 'fatsquare', 'fmsquare', 'amsawtooth', 'fmsawtooth'];

/** Classic mono lead: saw → resonant low-pass with filter envelope. */
export async function toneMono(ctx: AudioContext, out: AudioNode, random = false): Promise<Melodic> {
    const T = await loadTone(ctx);
    const { num, pick } = chooser(random);
    const synth = new T.MonoSynth({
        // Tone's oscillator type union is too wide for its option types: cast (all are valid OmniOscillator types)
        oscillator: { type: pick('sawtooth', MONO_WAVES) as 'sawtooth' },
        filter: { Q: num(3, 0.5, 9), type: 'lowpass' },
        // short attacks: a sequenced note lasts ~0.85 step (≈ 115 ms at 110 BPM), slow attacks never open up
        envelope: { attack: num(0.005, 0.001, 0.015), decay: num(0.2, 0.08, 0.6), sustain: num(0.5, 0.3, 0.9), release: num(0.2, 0.05, 0.6) },
        filterEnvelope: {
            attack: num(0.005, 0.001, 0.03),
            decay: num(0.25, 0.08, 0.7),
            sustain: num(0.3, 0.2, 0.8),
            release: 0.3,
            baseFrequency: num(200, 250, 1500),
            octaves: num(3.5, 2.5, 6),
        },
        portamento: num(0, 0, 0.06),
        volume: -9,
    });
    synth.connect(out);
    return melodic(synth as unknown as ToneSynth, (_hz, t) => synth.triggerRelease(t));
}

/** FM bells / e-piano-ish, polyphonic. */
export async function toneFm(ctx: AudioContext, out: AudioNode, random = false): Promise<Melodic> {
    const T = await loadTone(ctx);
    const { num, pick } = chooser(random);
    const synth = new T.PolySynth(T.FMSynth, {
        // frequency ratio modulator : carrier. Random: half the time a harmonic ratio, half the time a free (often inharmonic) one
        harmonicity: random && Math.random() < 0.5 ? num(3, 0.25, 8) : pick(3, [0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8]),
        modulationIndex: num(10, 1, 40),
        oscillator: { type: pick<'sine' | 'triangle' | 'square' | 'sawtooth'>('sine', ['sine', 'sine', 'triangle', 'square', 'sawtooth']) },
        modulation: { type: pick<'sine' | 'square' | 'triangle' | 'sawtooth'>('sine', ['sine', 'square', 'triangle', 'sawtooth']) },
        envelope: { attack: num(0.01, 0.001, 0.02), decay: num(0.3, 0.1, 0.9), sustain: num(0.4, 0.3, 0.8), release: num(0.6, 0.2, 1.5) },
        modulationEnvelope: { attack: num(0.01, 0.001, 0.05), decay: num(0.2, 0.05, 0.8), sustain: num(0.3, 0.1, 0.8), release: 0.4 },
        volume: -13,
    });
    synth.connect(out);
    return melodic(synth as unknown as ToneSynth, (hz, t) => synth.triggerRelease(hz, t));
}

/** Detuned super-saw pad, polyphonic (also meant for a chords track). */
export async function tonePad(ctx: AudioContext, out: AudioNode, random = false): Promise<Melodic> {
    const T = await loadTone(ctx);
    const { num, pick } = chooser(random);
    const synth = new T.PolySynth(T.Synth, {
        oscillator: {
            type: pick<'fatsawtooth' | 'fatsquare' | 'fattriangle'>('fatsawtooth', ['fatsawtooth', 'fatsquare', 'fattriangle']),
            count: Math.round(num(3, 2, 6)),
            spread: num(30, 10, 80),
        },
        envelope: { attack: num(0.04, 0.005, 0.03), decay: num(0.3, 0.1, 0.8), sustain: num(0.6, 0.4, 0.9), release: num(0.8, 0.3, 2) },
        volume: -17,
    });
    synth.connect(out);
    return melodic(synth as unknown as ToneSynth, (hz, t) => synth.triggerRelease(hz, t));
}
