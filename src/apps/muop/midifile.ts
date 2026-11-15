// μOp → Standard MIDI File (type 1): the chain (or all patterns with notes) played like the sequencer plays it.
// Pure data, no audio / device. One MIDI track per used μOp track, plus a tempo track first (tempo, 4/4, key, markers).
//
// Followed like playback: per track rate + length (polymeter over the whole chain), note lengths (cut at the next
// note), harmony (transpose / follow the chords track), voicings, swing (baked in). Drums: GM notes (DRUM_SOUNDS).
// Not in the file: sounds / params / levels, punch-in FX (track FX like retrig / loop too), mute / solo (all tracks
// are written, so they can be muted in the DAW).
import { DRUMS, STEPS, isEmptyTrack, type Song } from './model';
import { chordAt, harmonyTrack, trackMidis } from './harmony';
import { soundingLength } from './sequencer';
import { DRUM_SOUNDS } from './sounds';

/** Ticks per quarter note: a clock step (16th) = 24 ticks, so every track rate (×2 … ÷16) is a whole number of ticks. */
const PPQ = 96;
const STEP_TICKS = PPQ / 4;
const NOTE_VELOCITY = 102; // the sequencer plays notes at 0.8
const DRUM_TICKS = STEP_TICKS / 2;
const DRUM_CHANNEL = 10;
/** Most passes "until aligned" renders (odd lengths can need many). */
export const MAX_PASSES = 32;

/** chain = the pattern chain as it plays; all = every pattern with notes, in order. */
export type MidiSource = 'chain' | 'all';
/** Passes through the sequence, or 'align' = until all tracks start their loop together again (≤ MAX_PASSES). */
export type MidiRepeat = 1 | 2 | 4 | 8 | 'align';
export interface MidiOptions {
    source: MidiSource;
    repeat: MidiRepeat;
    /** Track numbers left out (the harmony track still leads the others when left out). */
    exclude?: number[];
}

/** The used tracks that go into the file. */
export const midiTracks = (song: Song, exclude: number[] = []): number[] =>
    song.tracks.flatMap((t, i) => (t.kind !== null && !exclude.includes(i) ? [i] : []));

/** The patterns played one after the other (one bar each). */
export const midiSequence = (song: Song, source: MidiSource): number[] =>
    source === 'chain' ? [...song.chain] : song.patterns.flatMap((p, i) => (p.tracks.every(isEmptyTrack) ? [] : [i]));

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Passes until every used track loops around together with the sequence (capped: aligned = false). */
export function alignPasses(song: Song, sequence: number[], tracks = midiTracks(song)): { passes: number; aligned: boolean } {
    const ticks = 2 * sequence.length * STEPS; // in half clock steps: ×2 tracks have half-step periods
    let total = ticks;
    for (const i of tracks) {
        const t = song.tracks[i];
        const period = Math.round((2 * t.length) / t.rate);
        total = (total / gcd(total, period)) * period;
        if (total / ticks > MAX_PASSES) return { passes: MAX_PASSES, aligned: false };
    }
    return { passes: total / ticks, aligned: true };
}

/** What an export with these options contains. */
export function midiPlan(song: Song, options: MidiOptions): { sequence: number[]; passes: number; bars: number; aligned: boolean } {
    const sequence = midiSequence(song, options.source);
    const { passes, aligned } = options.repeat === 'align' ? alignPasses(song, sequence, midiTracks(song, options.exclude)) : { passes: options.repeat, aligned: true };
    return { sequence, passes, bars: sequence.length * passes, aligned };
}

/** Key signature meta data: sharps (+) / flats (-) and major / minor. Modes count by their third (dorian → minor). */
function keySignature(song: Song): number[] {
    const minor = ['minor', 'dorian', 'phrygian', 'harmonic', 'pent-minor'].includes(song.scale);
    const major = minor ? song.root + 3 : song.root; // the relative major
    let sf = (((major * 7) % 12) + 12) % 12; // steps on the circle of fifths
    if (sf > 6) sf -= 12; // Db (-5) rather than C# (+7)
    return [sf & 0xff, minor ? 1 : 0];
}

interface Note {
    time: number;
    length: number;
    pitch: number;
    velocity: number;
}

/** Variable length quantity (delta times, meta lengths). */
function vlq(n: number): number[] {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
}

const text = (s: string) => [...new TextEncoder().encode(s)];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const chunk = (id: string, data: number[]) => [...text(id), ...u32(data.length), ...data];
const meta = (type: number, data: number[]) => [0xff, type, ...vlq(data.length), ...data];

/** Events [time, bytes] → MTrk chunk (sorted by time, note-offs first on the same tick, end of track). */
function trackChunk(events: [number, number[]][]): number[] {
    const sorted = events
        .map((e, i) => ({ time: e[0], bytes: e[1], i, off: (e[1][0] & 0xf0) === 0x80 ? 0 : 1 }))
        .sort((a, b) => a.time - b.time || a.off - b.off || a.i - b.i);
    const data: number[] = [];
    let now = 0;
    for (const e of sorted) {
        data.push(...vlq(e.time - now), ...e.bytes);
        now = e.time;
    }
    data.push(0, ...meta(0x2f, []));
    return chunk('MTrk', data);
}

/** Notes per μOp track for `passes` times through the sequence (index = track, empty tracks = []). */
function render(song: Song, sequence: number[], passes: number): Note[][] {
    const notes: Note[][] = song.tracks.map(() => []);
    const ticks = passes * sequence.length * STEPS;
    const swing = Math.round((2 * Math.min(75, Math.max(50, song.swing)) / 100 - 1) * STEP_TICKS);
    const h = harmonyTrack(song);
    for (let tick = 0; tick < ticks; tick++) {
        const pattern = song.patterns[sequence[Math.floor(tick / STEPS) % sequence.length]];
        const stepStart = tick * STEP_TICKS + (tick % 2 === 1 ? swing : 0);
        const ht = song.tracks[h];
        const chord = h < 0 ? null : chordAt(pattern, h, ht.length, Math.floor(tick * ht.rate + 1e-9) % ht.length);
        song.tracks.forEach((track, i) => {
            if (track.kind === null) return;
            const trackStep = STEP_TICKS / track.rate;
            const first = Math.ceil(tick * track.rate - 1e-9);
            const end = (tick + 1) * track.rate - 1e-9;
            for (let k = first; k < end; k++) {
                const step = k % track.length;
                const steps = pattern.tracks[i];
                const time = Math.round(stepStart + (k / track.rate - tick) * STEP_TICKS);
                if (track.kind === 'drums') {
                    for (let sound = 0; sound < DRUMS; sound++) {
                        const v = steps.drums[sound][step];
                        if (v > 0) notes[i].push({ time, length: DRUM_TICKS, pitch: DRUM_SOUNDS[sound].gm, velocity: Math.max(1, Math.round(v * 127)) });
                    }
                    continue;
                }
                const n = steps.notes[step];
                if (n === null) continue;
                const length = Math.max(1, Math.round((soundingLength(steps.notes, steps.lengths, step, track.length) - 0.15) * trackStep));
                for (const pitch of trackMidis(track, n, chord, song)) {
                    if (pitch >= 0 && pitch <= 127) notes[i].push({ time, length, pitch, velocity: NOTE_VELOCITY });
                }
            }
        });
    }
    return notes;
}

/** The song as a .mid file (type 1, 96 ppq). `name` goes into the tempo track's name. Throws if there's nothing to export. */
export function songToMidi(song: Song, name: string, options: MidiOptions = { source: 'chain', repeat: 1 }): Uint8Array {
    const { sequence, passes } = midiPlan(song, options);
    if (!sequence.length) throw new Error('No pattern with notes to export');
    const included = midiTracks(song, options.exclude);
    if (!included.length) throw new Error('No track chosen to export');
    const notes = render(song, sequence, passes);
    const usPerQuarter = Math.round(60_000_000 / song.bpm);
    const bar = STEPS * STEP_TICKS;
    const markers: [number, number[]][] = Array.from({ length: passes * sequence.length }, (_, b) => [
        b * bar,
        meta(0x06, text(`Pattern ${sequence[b % sequence.length] + 1}`)),
    ]);
    const tracks = [
        trackChunk([
            [0, meta(0x03, text(name))],
            [0, meta(0x51, [(usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff])],
            [0, meta(0x58, [4, 2, 24, 8])], // 4/4
            [0, meta(0x59, keySignature(song))],
            ...markers,
            [markers.length * bar, meta(0x06, text('End'))], // the DAW sees the full length
        ]),
    ];
    // channels (counted over all used tracks): the track's MIDI channel if it has one, else drums on 10, others 1, 2, 3, … (skipping 10)
    let nextChannel = 1;
    song.tracks.forEach((track, i) => {
        if (track.kind === null) return;
        let channel = track.midi?.channel ?? (track.kind === 'drums' ? DRUM_CHANNEL : nextChannel++);
        if (!track.midi && track.kind !== 'drums' && channel === DRUM_CHANNEL) channel = nextChannel++;
        if (channel > 16) channel = ((channel - 1) % 16) + 1;
        const ch = channel - 1;
        if (!included.includes(i)) return; // after the channel count: leaving a track out doesn't move the others
        const events: [number, number[]][] = [[0, meta(0x03, text(track.name))]];
        for (const n of notes[i]) {
            events.push([n.time, [0x90 | ch, n.pitch, n.velocity]]);
            events.push([n.time + n.length, [0x80 | ch, n.pitch, 0]]);
        }
        tracks.push(trackChunk(events));
    });
    const header = chunk('MThd', [0, 1, (tracks.length >> 8) & 0xff, tracks.length & 0xff, (PPQ >> 8) & 0xff, PPQ & 0xff]);
    return new Uint8Array([...header, ...tracks.flat()]);
}
