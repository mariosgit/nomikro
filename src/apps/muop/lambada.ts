// μOp easter egg (SHIFT + VARIATION): fills a pattern with a lambada-style groove. Own melody, not the song.
// One bar: i (0–7) → iv (8–11) → V7 (12–15), 3-3-2 kick / bass, shaker 16ths, cowbell. Written in scale degrees,
// so it follows the song key (harm. minor gives the real V7, natural minor a v7).
// Pure data: the first drums / bass / lead / chords tracks get it, the other tracks of the pattern are cleared.
import { harmonyTrack, chordAt } from './harmony';
import { STEPS, emptyPatternTrack, scaleLength, type Pattern, type PatternTrack, type Song, type Track } from './model';

const KICK = 0, SNARE = 1, HAT = 2, OPEN = 3, LOW_TOM = 5, COWBELL = 7;

/** [drum sound, step, velocity] */
const DRUMS: [number, number, number][] = [
    [KICK, 0, 1], [KICK, 3, 0.75], [KICK, 6, 0.6], [KICK, 8, 1], [KICK, 11, 0.75], [KICK, 14, 0.6],
    [SNARE, 4, 0.8], [SNARE, 12, 0.85], [SNARE, 7, 0.25], [SNARE, 15, 0.3],
    [OPEN, 10, 0.35],
    [LOW_TOM, 13, 0.45], [LOW_TOM, 14, 0.35],
    [COWBELL, 2, 0.35], [COWBELL, 5, 0.3], [COWBELL, 10, 0.35],
    ...Array.from({ length: STEPS }, (_, s): [number, number, number] => [HAT, s, s % 4 === 0 ? 0.55 : s % 2 ? 0.25 : 0.4]),
];
/** Chords track: [step, chord, length]. 0 = i, 3 = iv, 12 = the 7th chord on degree 4 (V7). */
const CHORDS: [number, number, number][] = [[0, 0, 8], [8, 3, 4], [12, 12, 4]];
/** Bass: [step, chord tone (0 root, 1 3rd, 2 5th), length], 3-3-2. */
const BASS: [number, number, number][] = [[0, 0, 2], [3, 0, 2], [6, 2, 2], [8, 0, 2], [11, 0, 1], [12, 0, 2], [14, 2, 2]];
/** Lead: [step, scale degree (7 = the root an octave up), length]: falls on the 3-3-2, pickup through the 7th. */
const LEAD: [number, number, number][] = [[0, 11, 2], [3, 10, 2], [6, 9, 2], [8, 10, 1], [10, 12, 1], [11, 10, 1], [12, 8, 2], [14, 6, 2]];

const fill = (steps: PatternTrack, notes: [number, number, number][], value: (step: number, v: number) => number) => {
    for (const [s, v, len] of notes) {
        steps.notes[s] = value(s, v);
        steps.lengths[s] = len;
    }
};

/** Writes the lambada into `pattern` (call history.edit() first). Returns the names of the filled tracks. */
export function lambada(song: Song, pattern: Pattern): string[] {
    const kinds = song.tracks.map((t) => t.kind);
    const isBass = (t: Track) => t.kind === 'notes' && (t.octave < 0 || /bass/i.test(t.name));
    const drums = kinds.indexOf('drums');
    const chords = harmonyTrack(song);
    const bass = song.tracks.findIndex(isBass);
    const lead = song.tracks.findIndex((t) => t.kind === 'notes' && !isBass(t));
    const filled = [drums, bass, lead, chords].filter((i) => i >= 0);

    pattern.tracks = pattern.tracks.map(emptyPatternTrack);
    if (drums >= 0) for (const [d, s, v] of DRUMS) pattern.tracks[drums].drums[d][s] = v;
    if (chords >= 0) fill(pattern.tracks[chords], CHORDS, (_, c) => c);

    // notes tracks may follow the chords (transpose / follow): write the values so they sound as intended
    const n = scaleLength(song);
    const root = (s: number) => {
        const c = chords >= 0 ? chordAt(pattern, chords, song.tracks[chords].length, s) : null;
        return c === null ? null : (c % 8) % n;
    };
    const asValue = (t: Track, s: number, degree: number, tone: number | null) => {
        const r = root(s);
        if (r === null || t.harmony === 'free') return degree;
        if (t.harmony === 'transpose') return degree - r;
        return tone ?? Math.round((degree - r) / 2); // follow: chord tone index
    };
    // bass: chord tones → degrees over the chord root (no chords track: over the i chord)
    if (bass >= 0) fill(pattern.tracks[bass], BASS, (s, tone) => asValue(song.tracks[bass], s, (root(s) ?? 0) + tone * 2, tone));
    if (lead >= 0) fill(pattern.tracks[lead], LEAD, (s, degree) => asValue(song.tracks[lead], s, degree, null));
    return filled.map((i) => song.tracks[i].name);
}
