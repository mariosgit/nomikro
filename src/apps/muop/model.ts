// μOp song data: 16 patterns × (8 drum rows + 1 melody row) × 16 steps, a pattern chain, tempo. Pure data, no audio/device.

export const STEPS = 16;
export const PATTERNS = 16;
export const DRUMS = 8;

export interface Pattern {
    /** [sound][step]: velocity 0..1, 0 = off */
    drums: number[][];
    /** [step]: scale degree (see degreeToMidi), null = rest */
    melody: (number | null)[];
}

export interface Song {
    version: 1;
    patterns: Pattern[];
    /** Pattern numbers played in a loop. */
    chain: number[];
    bpm: number;
    /** 50..75 % */
    swing: number;
    /** 0..1 */
    volume: number;
}

export const emptyPattern = (): Pattern => ({
    drums: Array.from({ length: DRUMS }, () => Array<number>(STEPS).fill(0)),
    melody: Array<number | null>(STEPS).fill(null),
});

export const clonePattern = (p: Pattern): Pattern => ({ drums: p.drums.map((row) => [...row]), melody: [...p.melody] });

export const isEmptyPattern = (p: Pattern) => p.drums.every((row) => row.every((v) => v === 0)) && p.melody.every((d) => d === null);

/** A new song with a starter beat in pattern 1. */
export function newSong(): Song {
    const patterns = Array.from({ length: PATTERNS }, emptyPattern);
    const p = patterns[0];
    for (const s of [0, 6, 10]) p.drums[0][s] = 1; // kick
    for (const s of [4, 12]) p.drums[1][s] = 0.9; // snare
    for (let s = 0; s < STEPS; s += 2) p.drums[2][s] = s % 4 === 0 ? 0.7 : 0.4; // closed hat
    [0, null, null, 7, null, null, 4, null, 2, null, null, 4, null, 7, 9, null].forEach((d, s) => (p.melody[s] = d));
    return { version: 1, patterns, chain: [0], bpm: 110, swing: 54, volume: 0.8 };
}

// --- melody scale: A natural minor, degree 0 = A2 ---

const SCALE = [0, 2, 3, 5, 7, 8, 10];
const ROOT = 45; // A2
export const MIN_DEGREE = -7;
export const MAX_DEGREE = 27;

export function degreeToMidi(degree: number): number {
    const octave = Math.floor(degree / SCALE.length);
    return ROOT + 12 * octave + SCALE[degree - octave * SCALE.length];
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
export const degreeName = (degree: number) => midiName(degreeToMidi(degree));

// --- persistence (browser localStorage) ---

const KEY = 'muop/song/v1';

export function loadSong(): Song {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
            const s = JSON.parse(raw) as Song;
            if (s.version === 1 && s.patterns?.length === PATTERNS && s.chain?.length) return s;
        }
    } catch {
        // unreadable / blocked storage: start fresh
    }
    return newSong();
}

export function saveSong(song: Song): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(song));
    } catch {
        // storage full / blocked: keep playing
    }
}
