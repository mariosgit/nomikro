// μOp song data: 16 tracks, 16 patterns × 16 steps, a pattern chain, tempo. Pure data, no audio/device.
//
// Track kinds: 'drums' (8 drum sounds × 16 steps, velocity), 'notes' (one note per step: scale degree),
// 'chords' (one chord per step: chord number 0..15, see chordNotes()). kind null = empty track.
import type { Params } from '../../engine/instruments';

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
    /** The sound's parameter values (PLUG-IN page), missing = the instrument's default. */
    params: Params;
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
    /** Notes tracks: how they follow the harmony track (the first chords track). */
    harmony: HarmonyMode;
    /** Chords tracks: index into VOICINGS. */
    voicing: number;
    /** Mixer: muted = the sequencer skips it (sound and MIDI); solo = only the solo tracks play. Live pads still play. */
    mute: boolean;
    solo: boolean;
}

/** Does the sequencer play this track (mute / solo)? */
export const audible = (song: Song, track: number) => {
    const t = song.tracks[track];
    return !t.mute && (t.solo || !song.tracks.some((x) => x.solo));
};

/**
 * free = plays the scale degrees as written; transpose = shifted by the current chord's root (stays in the scale);
 * follow = the values are chord tones (0 = root, 1 = 3rd, 2 = 5th, 3 = root an octave up, …).
 */
export type HarmonyMode = 'free' | 'transpose' | 'follow';
export const HARMONY_MODES: readonly HarmonyMode[] = ['free', 'transpose', 'follow'];

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
    /** notes / chords: length per step in track steps (1 = one step, more = held over the next steps). */
    lengths: number[];
}

/** Longest note: a whole bar. */
export const MAX_LENGTH = STEPS;

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
    /** Song key: root pitch class 0..11 (C = 0) and scale id (SCALES). Steps store scale degrees, so it transposes the song. */
    root: number;
    scale: string;
}

export type Key = Pick<Song, 'root' | 'scale'>;

const TRACK_DEFAULTS = { rate: 1, length: STEPS, midi: null, harmony: 'free', voicing: 0, mute: false, solo: false } as const;
/** An unused track slot (hidden in the track list). */
export const emptyTrack = (n: number): Track => ({ kind: null, name: `Track ${n + 1}`, sound: '', params: {}, level: 1, octave: 0, ...TRACK_DEFAULTS });

/** New songs: Drums, Bass, Lead, Chords (the chords track drives the harmony wherever it is). */
const DEFAULT_TRACKS: Track[] = [
    { kind: 'drums', name: 'Drums', sound: 'tone', params: {}, level: 1, octave: 0, ...TRACK_DEFAULTS },
    { kind: 'notes', name: 'Bass', sound: 'basic-lead', params: {}, level: 1, octave: -1, ...TRACK_DEFAULTS },
    { kind: 'notes', name: 'Lead', sound: 'tone-mono', params: {}, level: 1, octave: 0, ...TRACK_DEFAULTS },
    { kind: 'chords', name: 'Chords', sound: 'tone-pad', params: {}, level: 0.8, octave: 0, ...TRACK_DEFAULTS },
];

/** The Lead track's index in new songs (v1 songs: melody → Lead). */
const LEAD = 2;

export const emptyPatternTrack = (): PatternTrack => ({
    drums: Array.from({ length: DRUMS }, () => Array<number>(STEPS).fill(0)),
    notes: Array<number | null>(STEPS).fill(null),
    lengths: Array<number>(STEPS).fill(1),
});

export const clonePatternTrack = (t: PatternTrack): PatternTrack => ({ drums: t.drums.map((row) => [...row]), notes: [...t.notes], lengths: [...t.lengths] });

export const emptyPattern = (): Pattern => ({
    tracks: Array.from({ length: TRACKS }, emptyPatternTrack),
    fx: Array.from({ length: STEPS }, () => []),
});

export const clonePattern = (p: Pattern): Pattern => ({
    tracks: p.tracks.map(clonePatternTrack),
    fx: p.fx.map((hits) => hits.map((h) => ({ ...h }))),
});

export const isEmptyTrack = (t: PatternTrack) => t.drums.every((row) => row.every((v) => v === 0)) && t.notes.every((d) => d === null);
export const isEmptyPattern = (p: Pattern) => p.tracks.every(isEmptyTrack) && p.fx.every((hits) => !hits.length);

/** A new song with a starter groove in pattern 1. */
export function newSong(): Song {
    const patterns = Array.from({ length: PATTERNS }, emptyPattern);
    const [drums, bass, lead, chords] = patterns[0].tracks;
    for (const s of [0, 6, 10]) drums.drums[0][s] = 1; // kick
    for (const s of [4, 12]) drums.drums[1][s] = 0.9; // snare
    for (let s = 0; s < STEPS; s += 2) drums.drums[2][s] = s % 4 === 0 ? 0.7 : 0.4; // closed hat
    for (const [s, d] of [[0, 0], [3, 0], [6, 7], [8, 5], [11, 5], [14, 4]]) bass.notes[s] = d;
    chords.notes[0] = 0; // Am
    chords.notes[8] = 5; // F
    [7, null, null, 9, null, null, 11, null, 9, null, null, 7, null, 4, null, null].forEach((d, s) => (lead.notes[s] = d));
    return {
        version: 2,
        tracks: Array.from({ length: TRACKS }, (_, i) => (DEFAULT_TRACKS[i] ? { ...DEFAULT_TRACKS[i], params: {} } : emptyTrack(i))),
        patterns,
        chain: [0],
        bpm: 110,
        swing: 54,
        volume: 0.8,
        root: 9,
        scale: 'minor',
    };
}

// --- key: root + scale. Degree 0 = the root in octave 2 (C2..B2), plus the track's octave offset ---

export const SCALES: readonly { id: string; name: string; steps: readonly number[] }[] = [
    { id: 'minor', name: 'minor', steps: [0, 2, 3, 5, 7, 8, 10] },
    { id: 'major', name: 'major', steps: [0, 2, 4, 5, 7, 9, 11] },
    { id: 'dorian', name: 'dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
    { id: 'mixolydian', name: 'mixolyd.', steps: [0, 2, 4, 5, 7, 9, 10] },
    { id: 'phrygian', name: 'phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
    { id: 'lydian', name: 'lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
    { id: 'harmonic', name: 'harm. minor', steps: [0, 2, 3, 5, 7, 8, 11] },
    { id: 'pent-minor', name: 'pent. minor', steps: [0, 3, 5, 7, 10] },
    { id: 'pent-major', name: 'pent. major', steps: [0, 2, 4, 7, 9] },
];
/** Scales on the CHORDS page pads 13–16. */
export const QUICK_SCALES = ['minor', 'major', 'dorian', 'mixolydian'] as const;

export const findScale = (id: string) => SCALES.find((s) => s.id === id) ?? SCALES[0];
/** Notes per octave of the key's scale (7, or 5 for the pentatonics). */
export const scaleLength = (key: Key) => findScale(key.scale).steps.length;
export const MIN_DEGREE = -7;
export const MAX_DEGREE = 27;

const mod = (n: number, m: number) => ((n % m) + m) % m;

export function degreeToMidi(degree: number, octave: number, key: Key): number {
    const steps = findScale(key.scale).steps;
    const o = Math.floor(degree / steps.length);
    return 36 + key.root + 12 * (o + octave) + steps[degree - o * steps.length];
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = (midi: number) => `${NOTE_NAMES[mod(midi, 12)]}${Math.floor(midi / 12) - 1}`;
export const degreeName = (degree: number, octave: number, key: Key) => midiName(degreeToMidi(degree, octave, key));
export const keyName = (key: Key) => `${NOTE_NAMES[mod(key.root, 12)]} ${findScale(key.scale).name}`;

// --- chords: pads 1–8 = triads on scale degrees 0..7, pads 9–16 = the same as seventh chords ---

export const CHORDS = 16;
export const VOICINGS = ['close', '1st inv', '2nd inv', 'open', 'sus2', 'sus4'] as const;

/** Root scale degree of a chord (for colors, transpose / follow). */
export const chordRoot = (chord: number) => chord % 8;

/** Scale degrees of a chord in root position (stacked thirds; sus2 / sus4 move the third). */
function chordDegrees(chord: number, voicing: number): number[] {
    const root = chordRoot(chord);
    const degrees = chord < 8 ? [0, 2, 4] : [0, 2, 4, 6];
    if (VOICINGS[voicing] === 'sus2') degrees[1] = 1;
    if (VOICINGS[voicing] === 'sus4') degrees[1] = 3;
    return degrees.map((d) => root + d);
}

/** Midi notes of chord 0..15 in the key, with the voicing (inversions move the lowest notes up an octave). */
export function chordNotes(chord: number, octave: number, key: Key, voicing = 0): number[] {
    const notes = chordDegrees(chord, voicing).map((d) => degreeToMidi(d, octave, key));
    const v = VOICINGS[voicing];
    if (v === '1st inv') notes[0] += 12;
    if (v === '2nd inv') (notes[0] += 12), (notes[1] += 12);
    if (v === 'open') notes[1] += 12;
    return notes.sort((a, b) => a - b);
}

const QUALITY: Record<string, string> = {
    '4,3': '', '3,4': 'm', '3,3': 'dim', '4,4': 'aug', '2,5': 'sus2', '5,2': 'sus4',
    '4,3,4': 'maj7', '4,3,3': '7', '3,4,3': 'm7', '3,3,4': 'm7b5', '3,4,4': 'mMaj7', '4,4,3': 'maj7#5',
    '2,5,3': '7sus2', '5,2,3': '7sus4', '2,5,4': 'maj7sus2', '5,2,4': 'maj7sus4',
};

/** E.g. "Am", "Fmaj7", "Bm7b5", "Am/C" (inversion). */
export function chordName(chord: number, key: Key, voicing = 0): string {
    const notes = chordDegrees(chord, voicing).map((d) => degreeToMidi(d, 0, key));
    const steps = notes.slice(1).map((n, i) => n - notes[i]).join(',');
    const name = `${NOTE_NAMES[mod(notes[0], 12)]}${QUALITY[steps] ?? '*'}`;
    const bass = chordNotes(chord, 0, key, voicing)[0];
    return mod(bass, 12) === mod(notes[0], 12) ? name : `${name}/${NOTE_NAMES[mod(bass, 12)]}`;
}

// --- persistence: parsing stored / imported songs (storage itself: projects.ts) ---

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
        pattern.tracks[LEAD].notes = [...p.melody];
        return pattern;
    });
    if (old.sounds?.drums) song.tracks[0].sound = old.sounds.drums;
    if (old.sounds?.melody) song.tracks[LEAD].sound = old.sounds.melody;
    song.tracks[0].level = old.levels?.drums ?? 1;
    song.tracks[LEAD].level = old.levels?.melody ?? 1;
    return song;
}

/**
 * A stored / imported song → a full v2 `Song` with defaults for fields added later (old saves and files keep working),
 * or null if it isn't one. v1 songs are migrated. `version` newer than this app knows → throws (made with a newer μOp).
 */
export function parseSong(data: unknown): Song | null {
    if (!data || typeof data !== 'object') return null;
    const s = data as Song | SongV1;
    if (typeof s.version === 'number' && s.version > 2) throw new Error(`Song version ${s.version}: made with a newer μOp`);
    if (s.version === 1) return s.patterns?.length === PATTERNS ? migrateV1(s) : null;
    if (s.version !== 2 || s.tracks?.length !== TRACKS || s.patterns?.length !== PATTERNS || !s.chain?.length) return null;
    for (const p of s.patterns) {
        p.fx ??= Array.from({ length: STEPS }, () => []); // saved before punch-in FX
        for (const t of p.tracks) t.lengths ??= Array<number>(STEPS).fill(1); // saved before note lengths
    }
    for (const t of s.tracks) {
        // saved before clock / length / MIDI per track
        t.rate ??= 1;
        t.length ??= STEPS;
        t.midi ??= null;
        t.harmony ??= 'free';
        t.voicing ??= 0;
        t.params ??= {}; // saved before sound parameters
        t.mute ??= false; // saved before the mixer
        t.solo ??= false;
    }
    s.root ??= 9; // A minor was fixed before
    s.scale ??= 'minor';
    return s;
}

/** The song saved before projects existed (v2, or v1 migrated), null if none. Read once to create the first project. */
export function legacySong(): Song | null {
    for (const key of [KEY, KEY_V1]) {
        try {
            const raw = localStorage.getItem(key);
            const song = raw ? parseSong(JSON.parse(raw)) : null;
            if (song) return song;
        } catch {
            // unreadable / blocked storage
        }
    }
    return null;
}
