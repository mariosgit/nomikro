// μOp harmony: the first chords track leads, notes tracks follow it (per track: free / transpose / follow).
// Pure functions over the song data, used by the sequencer (playback) and the controller (live pads, display).
import { CHORDS, chordNotes, chordRoot, degreeToMidi, scaleLength, type Key, type Pattern, type Song, type Track } from './model';

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** The harmony track: the first chords track, -1 = none. */
export const harmonyTrack = (song: Song) => song.tracks.findIndex((t) => t.kind === 'chords');

/**
 * The chord sounding on the harmony track at its step `step`: the last chord at or before it (empty steps keep the
 * chord), wrapping around the track's length. null = no chords in the pattern.
 */
export function chordAt(pattern: Pattern, track: number, length: number, step: number): number | null {
    const notes = pattern.tracks[track].notes;
    for (let j = 0; j < length; j++) {
        const v = notes[mod(step - j, length)];
        if (v !== null && v >= 0 && v < CHORDS) return v;
    }
    return null;
}

/** Scale degree a notes value plays, given the track's harmony mode and the current chord (null = none: plays as written). */
export function noteDegree(track: Track, value: number, chord: number | null, key: Key): number {
    if (chord === null || track.harmony === 'free') return value;
    const n = scaleLength(key);
    const root = chordRoot(chord) % n; // chord 8 roots: 0..7, 7 = the octave of 0
    if (track.harmony === 'transpose') return value + root;
    // follow: value = chord tone index (root, 3rd, 5th, then the next octave)
    return root + [0, 2, 4][mod(value, 3)] + n * Math.floor(value / 3);
}

/** Midi notes for a step / pad value on a track (chords: the chord with the track's voicing). */
export function trackMidis(track: Track, value: number, chord: number | null, key: Key): number[] {
    if (track.kind === 'chords') return value >= 0 && value < CHORDS ? chordNotes(value, track.octave, key, track.voicing) : [];
    return [degreeToMidi(noteDegree(track, value, chord, key), track.octave, key)];
}

/**
 * Likely next chords after `from` (pads 0..15), 0..1. Idea from Floyd Steinberg's "Chorder" (own implementation):
 * root moves by semitones, V +7, IV +5, vi +9, ii +2, vii° +11, iii +4, same root (color chords) 0.5.
 * Added for minor keys (Chorder thinks in major): ♭VI +8, ♭VII +10, ♭III +3.
 */
const MOVES: Record<number, number> = { 7: 1, 5: 0.9, 9: 0.85, 8: 0.8, 10: 0.8, 2: 0.75, 3: 0.7, 11: 0.7, 4: 0.6, 0: 0.5 };
export function nextChordWeights(from: number, key: Key): number[] {
    const pc = (chord: number) => mod(degreeToMidi(chordRoot(chord), 0, key), 12);
    const base = pc(from);
    return Array.from({ length: CHORDS }, (_, c) => (c === from ? 0 : (MOVES[mod(pc(c) - base, 12)] ?? 0.3) * (c < 8 ? 1 : 0.9)));
}
