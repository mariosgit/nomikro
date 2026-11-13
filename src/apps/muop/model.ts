// μOp song data: 16 tracks, 16 patterns × 16 steps, a pattern chain, tempo. Pure data, no audio/device.
//
// Track kinds: 'drums' (8 drum sounds × 16 steps, velocity), 'notes' (one note per step: scale degree),
// 'chords' (one chord per step: chord number 0..15, see chordNotes()). kind null = empty track.

export const STEPS = 16;
export const PATTERNS = 16;
export const TRACKS = 16;
export const DRUMS = 8;

export type TrackKind = 'drums' | 'notes' | 'chords';

export interface Track {
    kind: TrackKind | null;
    name: string;
    /** Instrument id (src/engine/instruments/): a drum kit for 'drums', a melodic instrument otherwise. */
    sound: string;
    /** Track volume 0..1.5 (1 = as designed). */
    level: number;
    /** Octave offset for notes / chords (bass: -1). */
    octave: number;
    /** Track steps per clock step (16th): 2 = double time, 1/4 = one step per beat, 1/16 = one per bar (RATES). */
    rate: number;
    /** Steps the track loops over, 1..16 (polymeter). */
    length: number;
    /** MIDI out instead of the internal sound, null = internal. */
    midi: TrackMidi | null;
}

export interface TrackMidi {
    /** MIDIOutput id. */
    port: string;
    /** Port name, to show it while the port isn't there. */
    name: string;
    /** 1..16 */
    channel: number;
}

/** Clock rates, slow → fast. */
export const RATES = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2] as const;
export const rateName = (rate: number) => (rate >= 1 ? `×${rate}` : `÷${Math.round(1 / rate)}`);
export const KINDS: readonly (TrackKind | null)[] = [null, 'drums', 'notes', 'chords'];
export const kindName = (kind: TrackKind | null) => (kind === null ? 'empty' : `${kind[0].toUpperCase()}${kind.slice(1)}`);

export interface PatternTrack {
    /** drums: [sound][step] velocity 0..1, 0 = off */
    drums: number[][];
    /** notes: scale degree per step; chords: chord number per step; null = rest */
    notes: (number | null)[];
}

/** A recorded punch-in FX on a step: FX number 0..15 (see fx.ts), `track` for the track FX (pads 1–8). */
export interface FxHit {
    fx: number;
    track?: number;
}

export interface Pattern {
    tracks: PatternTrack[];
    /** [step]: punch-in FX recorded on that step (REC + PERFORM). */
    fx: FxHit[][];
}

export interface Song {
    version: 2;
    tracks: Track[];
    patterns: Pattern[];
    /** Pattern numbers played in a loop. */
    chain: number[];
    bpm: number;
    /** 50..75 % */
    swing: number;
    /** Master volume 0..1 */
    volume: number;
}

const TRACK_DEFAULTS = { rate: 1, length: STEPS, midi: null } as const;
const emptyTrack = (n: number): Track => ({ kind: null, name: `Track ${n + 1}`, sound: '', level: 1, octave: 0, ...TRACK_DEFAULTS });

/** Tracks 1–4 of a new song. */
const DEFAULT_TRACKS: Track[] = [
    { kind: 'drums', name: 'Drums', sound: 'tone', level: 1, octave: 0, ...TRACK_DEFAULTS },
    { kind: 'notes', name: 'Bass', sound: 'basic-lead', level: 1, octave: -1, ...TRACK_DEFAULTS },
    { kind: 'chords', name: 'Chords', sound: 'tone-pad', level: 0.8, octave: 0, ...TRACK_DEFAULTS },
    { kind: 'notes', name: 'Lead', sound: 'tone-mono', level: 1, octave: 0, ...TRACK_DEFAULTS },
];

export const emptyPatternTrack = (): PatternTrack => ({
    drums: Array.from({ length: DRUMS }, () => Array<number>(STEPS).fill(0)),
    notes: Array<number | null>(STEPS).fill(null),
});

export const emptyPattern = (): Pattern => ({
    tracks: Array.from({ length: TRACKS }, emptyPatternTrack),
    fx: Array.from({ length: STEPS }, () => []),
});

export const clonePattern = (p: Pattern): Pattern => ({
    tracks: p.tracks.map((t) => ({ drums: t.drums.map((row) => [...row]), notes: [...t.notes] })),
    fx: p.fx.map((hits) => hits.map((h) => ({ ...h }))),
});

export const isEmptyTrack = (t: PatternTrack) => t.drums.every((row) => row.every((v) => v === 0)) && t.notes.every((d) => d === null);
export const isEmptyPattern = (p: Pattern) => p.tracks.every(isEmptyTrack) && p.fx.every((hits) => !hits.length);

/** A new song with a starter groove in pattern 1. */
export function newSong(): Song {
    const patterns = Array.from({ length: PATTERNS }, emptyPattern);
    const [drums, bass, chords, lead] = patterns[0].tracks;
    for (const s of [0, 6, 10]) drums.drums[0][s] = 1; // kick
    for (const s of [4, 12]) drums.drums[1][s] = 0.9; // snare
    for (let s = 0; s < STEPS; s += 2) drums.drums[2][s] = s % 4 === 0 ? 0.7 : 0.4; // closed hat
    for (const [s, d] of [[0, 0], [3, 0], [6, 7], [8, 5], [11, 5], [14, 4]]) bass.notes[s] = d;
    chords.notes[0] = 0; // Am
    chords.notes[8] = 5; // F
    [7, null, null, 9, null, null, 11, null, 9, null, null, 7, null, 4, null, null].forEach((d, s) => (lead.notes[s] = d));
    return {
        version: 2,
        tracks: Array.from({ length: TRACKS }, (_, i) => (DEFAULT_TRACKS[i] ? { ...DEFAULT_TRACKS[i] } : emptyTrack(i))),
        patterns,
        chain: [0],
        bpm: 110,
        swing: 54,
        volume: 0.8,
    };
}

// --- scale: A natural minor, degree 0 = A2 (octave offset per track) ---

const SCALE = [0, 2, 3, 5, 7, 8, 10];
const ROOT = 45; // A2
export const MIN_DEGREE = -7;
export const MAX_DEGREE = 27;

export function degreeToMidi(degree: number, octave = 0): number {
    const o = Math.floor(degree / SCALE.length);
    return ROOT + 12 * (o + octave) + SCALE[degree - o * SCALE.length];
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
export const degreeName = (degree: number, octave = 0) => midiName(degreeToMidi(degree, octave));

// --- chords: pads 1–8 = triads on scale degrees 0..7, pads 9–16 = the same as seventh chords ---

export const CHORDS = 16;

/** Midi notes of chord 0..15 (stacked thirds in the scale). */
export function chordNotes(chord: number, octave = 0): number[] {
    const root = chord % 8;
    const size = chord < 8 ? 3 : 4;
    return Array.from({ length: size }, (_, i) => degreeToMidi(root + 2 * i, octave));
}

/** Root scale degree of a chord (for colors). */
export const chordRoot = (chord: number) => chord % 8;

const QUALITY: Record<string, string> = {
    '4,3': '', '3,4': 'm', '3,3': 'dim', '4,4': 'aug',
    '4,3,4': 'maj7', '4,3,3': '7', '3,4,3': 'm7', '3,3,4': 'm7b5', '3,4,4': 'mMaj7',
};

/** E.g. "Am", "Fmaj7", "Bm7b5". */
export function chordName(chord: number): string {
    const notes = chordNotes(chord);
    const steps = notes.slice(1).map((n, i) => n - notes[i]).join(',');
    return `${NAMES[notes[0] % 12]}${QUALITY[steps] ?? '?'}`;
}

// --- persistence (browser localStorage) ---

const KEY = 'muop/song/v2';
const KEY_V1 = 'muop/song/v1';

interface SongV1 {
    version: 1;
    patterns: { drums: number[][]; melody: (number | null)[] }[];
    chain: number[];
    bpm: number;
    swing: number;
    volume: number;
    sounds?: { drums?: string; melody?: string };
    levels?: { drums?: number; melody?: number };
}

/** v1 (drums + one melody) → v2: drums go to track 1, the melody to track 4 (Lead), with their sounds and levels. */
function migrateV1(old: SongV1): Song {
    const song = newSong();
    song.chain = old.chain;
    song.bpm = old.bpm;
    song.swing = old.swing;
    song.volume = old.volume;
    song.patterns = old.patterns.map((p) => {
        const pattern = emptyPattern();
        pattern.tracks[0].drums = p.drums.map((row) => [...row]);
        pattern.tracks[3].notes = [...p.melody];
        return pattern;
    });
    if (old.sounds?.drums) song.tracks[0].sound = old.sounds.drums;
    if (old.sounds?.melody) song.tracks[3].sound = old.sounds.melody;
    song.tracks[0].level = old.levels?.drums ?? 1;
    song.tracks[3].level = old.levels?.melody ?? 1;
    return song;
}

export function loadSong(): Song {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
            const s = JSON.parse(raw) as Song;
            if (s.version === 2 && s.tracks?.length === TRACKS && s.patterns?.length === PATTERNS && s.chain?.length) {
                for (const p of s.patterns) p.fx ??= Array.from({ length: STEPS }, () => []); // saved before punch-in FX
                for (const t of s.tracks) {
                    // saved before clock / length / MIDI per track
                    t.rate ??= 1;
                    t.length ??= STEPS;
                    t.midi ??= null;
                }
                return s;
            }
        }
        const v1 = localStorage.getItem(KEY_V1);
        if (v1) {
            const s = JSON.parse(v1) as SongV1;
            if (s.version === 1 && s.patterns?.length === PATTERNS) return migrateV1(s);
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
