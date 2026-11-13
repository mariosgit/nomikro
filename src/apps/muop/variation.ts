// μOp VARIATION: random patterns with a "déjà vu" control, inspired by Mutable Instruments Marbles
// (Émilie Gillet, MIT; https://github.com/pichenettes/eurorack, marbles/random/). Own implementation for a step
// sequencer: Marbles runs in real time, here a whole pattern is written at once.
//
// Every track keeps a loop of random values (one per step and stream). Déjà vu decides how much of it is reused:
//   0 → all new values, ½ → the same values again (locked), 1 → steps replay other steps' values (shuffled).
// Between 0 and ½ that share of steps gets new values (variation depth); between ½ and 1 that share jumps.
// So at ½, turning density / spread / bias reshapes the same "pattern identity".
import { CHORDS, DRUMS, STEPS, scaleLength, type Key, type PatternTrack, type Track } from './model';
import { nextChordWeights } from './harmony';

export interface GenSettings {
    /** Hits per step, 0..1 (½ = typical). */
    density: number;
    /** Drums: straight (0) ↔ busy offbeats (1). Notes: low (0) ↔ high (1) notes. */
    bias: number;
    /** Notes: range of the notes (0 = all near the bias, 1 = wide / extremes). Chords: share of 7th chords. */
    spread: number;
    /** Notes: 0 = any scale note, 1 = only the root (5th, 3rd in between). Chords: 0 = any move, 1 = only the strongest. */
    steps: number;
    /** 0..1, see above. */
    dejaVu: number;
    /** Regenerate every n bars while playing, 0 = off. */
    auto: number;
}

export const AUTO_BARS = [0, 1, 2, 4] as const;
export const DEFAULT_GEN: GenSettings = { density: 0.5, bias: 0.5, spread: 0.5, steps: 0.3, dejaVu: 0.25, auto: 0 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** One random value per step; déjà vu decides what is reused (see the top). */
class DejaVuLoop {
    private values = Array.from({ length: STEPS }, () => Math.random());

    pass(length: number, dejaVu: number): number[] {
        const p = (2 * dejaVu - 1) ** 2; // 1 at both ends, 0 at ½ (as in Marbles)
        return Array.from({ length }, (_, s) => {
            if (Math.random() >= p) return this.values[s];
            if (dejaVu <= 0.5) return (this.values[s] = Math.random()); // new value, kept in the loop
            return this.values[Math.floor(Math.random() * length)]; // jump: another step's value
        });
    }
}

/**
 * Value 0..1 from a uniform u: centered on `bias`, `spread` = width (a logistic stand-in for Marbles' beta
 * distribution: narrow → all near the bias, wide → piles up at both ends).
 */
function distribute(u: number, spread: number, bias: number): number {
    const k = 0.15 + 3 * spread;
    return sigmoid(logit(Math.min(0.98, Math.max(0.02, bias))) + k * logit(Math.min(0.999, Math.max(0.001, u))));
}

/** Position class of a step in the bar: 0 downbeat, 1 half, 2 quarters, 3 8ths, 4 16ths. */
const posClass = (s: number) => (s % 16 === 0 ? 0 : s % 8 === 0 ? 1 : s % 4 === 0 ? 2 : s % 2 === 0 ? 3 : 4);
/** How strong a step is (for notes / chords rhythm). */
const METRIC = [1, 0.85, 0.7, 0.45, 0.2];
/** Drum sounds (DRUM_ROLES order): hit probability per position class at density ½. */
const DRUM_SHAPES = [
    [1, 0.8, 0.45, 0.3, 0.12], // kick
    [0, 0.05, 1, 0.08, 0.08], // snare: 2 and 4
    [0.9, 0.9, 0.9, 0.85, 0.35], // closed hat
    [0, 0, 0, 0.3, 0.04], // open hat: offbeat 8ths
    [0, 0.05, 0.45, 0.05, 0.05], // clap
    [0.02, 0.02, 0.03, 0.04, 0.06], // low tom
    [0.02, 0.02, 0.03, 0.04, 0.06], // high tom
    [0.04, 0.02, 0.04, 0.06, 0.06], // cowbell
];
/** Bias moves weight from the strong to the weak positions. */
const BIAS_SHIFT = [-0.6, -0.3, 0, 0.7, 1.4];
const ACCENT = [0.95, 0.85, 0.8, 0.65, 0.5];

/** Per track: the settings and the déjà vu loops (one per stream). Lives in memory, not in the song. */
export class Generator {
    settings: GenSettings = { ...DEFAULT_GEN };
    private loops = new Map<string, DejaVuLoop>();

    private stream(name: string, length: number): number[] {
        let loop = this.loops.get(name);
        if (!loop) this.loops.set(name, (loop = new DejaVuLoop()));
        return loop.pass(length, this.settings.dejaVu);
    }

    /** Writes a new pattern into `steps` (the track's first `length` steps). Drums: `sound` = only that one. */
    generate(track: Track, steps: PatternTrack, key: Key, sound?: number): void {
        const len = track.length;
        if (track.kind === 'drums') this.drums(steps, len, sound);
        else if (track.kind === 'notes') this.notes(track, steps, len, key);
        else if (track.kind === 'chords') this.chords(steps, len, key);
    }

    private drums(steps: PatternTrack, len: number, only?: number): void {
        const { density, bias } = this.settings;
        for (let d = 0; d < DRUMS; d++) {
            if (only !== undefined && d !== only) continue;
            const u = this.stream(`drum${d}`, len);
            for (let s = 0; s < len; s++) {
                const c = posClass(s);
                const fill = d >= 5 && s % 16 >= 12 ? 2 : 1; // toms / cowbell like the end of the bar
                const p = clamp01(DRUM_SHAPES[d][c] * fill * (1 + (bias - 0.5) * 2 * BIAS_SHIFT[c]) * density * 2);
                // the velocity comes from the same random value, so déjà vu keeps it too
                steps.drums[d][s] = u[s] < p ? Math.round(ACCENT[c] * (0.8 + 0.2 * (1 - u[s] / p)) * 100) / 100 : 0;
            }
        }
    }

    private notes(track: Track, steps: PatternTrack, len: number, key: Key): void {
        const { density, spread, bias } = this.settings;
        const t = this.stream('t', len);
        const x = this.stream('x', len);
        // follow: values are chord tones (root, 3rd, 5th, …) over 2 octaves; else scale degrees over 2 octaves
        const follow = track.harmony === 'follow';
        const per = follow ? 3 : scaleLength(key);
        const range = 2 * per;
        for (let s = 0; s < len; s++) {
            const p = clamp01(density * 2 * (0.4 + 0.6 * METRIC[posClass(s)]));
            if (t[s] >= p) {
                steps.notes[s] = null;
                continue;
            }
            const raw = distribute(x[s], spread, bias) * range;
            steps.notes[s] = this.snap(raw, per, follow, range);
        }
    }

    /** Nearest allowed value: Steps keeps only the more important notes (root > 5th > 3rd > the rest). */
    private snap(raw: number, per: number, follow: boolean, range: number): number {
        const importance = (v: number) => {
            const i = ((v % per) + per) % per;
            if (follow) return [1, 0.6, 0.8][i];
            return i === 0 ? 1 : per === 7 ? ({ 4: 0.8, 2: 0.6 } as Record<number, number>)[i] ?? 0.3 : i === 3 ? 0.8 : 0.4;
        };
        const min = this.settings.steps * 0.95;
        let best = 0;
        for (let v = 0; v <= range; v++) {
            if (importance(v) < min) continue;
            if (Math.abs(v - raw) < Math.abs(best - raw) || importance(best) < min) best = v;
        }
        return best;
    }

    private chords(steps: PatternTrack, len: number, key: Key): void {
        const { density, spread } = this.settings;
        const t = this.stream('t', len);
        const x = this.stream('x', len);
        const seventh = this.stream('7', len);
        const sharpness = 1 + this.settings.steps * 4;
        let prev = 0;
        for (let s = 0; s < len; s++) {
            const strong = METRIC[posClass(s)] >= 0.7;
            const hit = s === 0 || t[s] < clamp01(density * 2 * (strong ? 0.9 : 0.12));
            if (!hit) {
                steps.notes[s] = null;
                continue;
            }
            // the next chord, picked along the "likely next chord" weights (triads 0..7); step 1 likes the tonic
            const w = nextChordWeights(prev, key)
                .slice(0, 8)
                .map((v, c) => (s === 0 ? (c === 0 ? 3 : v * 0.3) : v) ** sharpness);
            const total = w.reduce((a, b) => a + b, 0);
            let pick = x[s] * total;
            let chord = 0;
            while (chord < 7 && pick >= w[chord]) pick -= w[chord++];
            if (seventh[s] < spread * 0.6) chord += 8;
            steps.notes[s] = Math.min(chord, CHORDS - 1);
            prev = chord % 8;
        }
    }
}
