// μOp controller: device input → song edits / playback, song state → pad + button lights + display.
// The page reads `view` (subscribe()); the device is the main instrument.
// Everything (pads, STEP, REC, ERASE, SEARCH, STAR, VOLUME) acts on the selected track (SELECT + pad).
import { STRIP_LEDS, STRIP_MAX, type Color, type InputEvent, type LedButton, type MaschineMikroMk3 } from '../../maschine';
import {
    CHORDS,
    DRUMS,
    MAX_DEGREE,
    MIN_DEGREE,
    chordName,
    chordNotes,
    chordRoot,
    clonePattern,
    degreeName,
    degreeToMidi,
    isEmptyPattern,
    saveSong,
    type Song,
    type Track,
    type TrackKind,
} from './model';
import { Sequencer, type Target } from './sequencer';
import { devlog } from '../../dev/devlog';
import { Metronome } from '../../engine/metronome';
import { DRUM_SOUNDS, soundsFor, type Sounds } from './sounds';
import { findInstrument, nextInstrument, type Voice } from '../../engine/instruments';

export interface Cell {
    color: Color;
    level: number;
}

export interface TrackView {
    name: string;
    kind: TrackKind | null;
    sound: string;
    level: number;
    octave: number;
    /** Plays a random variation (STAR, not stored). */
    random: boolean;
}

export interface MuOpView {
    /** Selected track 0..15. */
    track: number;
    tracks: TrackView[];
    stepMode: boolean;
    drumSound: number;
    /** Value written by step taps on the selected notes / chords track (the last note / chord played). */
    pen: number;
    playing: boolean;
    recording: boolean;
    metronome: boolean;
    pattern: number;
    chain: number[];
    pendingChain: number[] | null;
    bpm: number;
    swing: number;
    volume: number;
    /** Playhead step, -1 = stopped. */
    step: number;
    /** What the pads show (grid + playhead), pad 0 = bottom left. */
    cells: Cell[];
    /** Last display message. */
    message: string;
}

type Layer = ReturnType<MaschineMikroMk3['lights']['layer']>;

const OFF: Cell = { color: 'off', level: 0 };
const MODIFIERS: LedButton[] = ['select', 'pattern', 'duplicate', 'erase', 'tempo', 'swing', 'volume'];
const NOTE_COLORS: Color[] = ['orange', 'yellow', 'lime', 'green', 'cyan', 'blue', 'violet'];
export const noteColor = (degree: number): Color => NOTE_COLORS[((degree % 7) + 7) % 7];
/** Track color by kind (bass = notes an octave down: blue). */
export const trackColor = (t: Pick<Track, 'kind' | 'octave'>): Color =>
    t.kind === 'drums' ? 'red' : t.kind === 'chords' ? 'violet' : t.kind === 'notes' ? (t.octave < 0 ? 'blue' : 'green') : 'off';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class MuOpController {
    view: MuOpView;

    private seq: Sequencer;
    private metronome = new Metronome();
    private grid: Layer;
    private playhead: Layer;
    private flashLayer: Layer;
    private track = 0;
    private stepMode = false;
    private recording = false;
    private drumSound = 0;
    /** Per track: the note / chord written by step taps. */
    private pens: number[];
    private step = -1;
    private message = 'μOp';
    /** Pattern taps while PATTERN is held (1 tap = select, more = chain). */
    private tapChain: number[] = [];
    /** Notes / chords step held in step mode: encoder edits it; a tap without edit on an existing one clears it. */
    private heldStep: { pad: number; created: boolean; edited: boolean } | null = null;
    private liveVoices = new Map<number, Voice[]>();
    private flashTimers = new Map<number, ReturnType<typeof setTimeout>>();
    private listeners = new Set<() => void>();
    private notifyQueued = false;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    private sayTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private m: MaschineMikroMk3,
        private song: Song,
        private sounds: Sounds,
    ) {
        this.seq = new Sequencer(song, sounds);
        this.grid = m.lights.layer('grid');
        this.playhead = m.lights.layer('playhead');
        this.flashLayer = m.lights.layer('flash');
        this.pens = song.tracks.map(() => 0);
        sounds.volume = song.volume;
        this.view = this.makeView();
    }

    private get cur(): Track {
        return this.song.tracks[this.track];
    }

    /** Owns the device until the signal aborts. */
    async run(signal: AbortSignal): Promise<void> {
        const offInput = this.m.input.onAny((e) => this.handle(e));
        const offMetronome = this.metronome.attach(this.seq.clock);
        const offStep = this.seq.onStep((s) =>
            this.seq.clock.at(s.time, () => {
                this.step = s.step;
                if (!this.stepMode && !this.trackView() && !this.modifierView()) {
                    for (const pad of s.pads[this.track]) if (pad >= 0 && pad < 16) this.flash(pad, this.padColor(pad));
                }
                this.update();
            }),
        );
        this.say('μOp\nSELECT + pad: track');
        // instruments load in the background (Tone.js is fetched on first use); the pads play as soon as they're ready
        this.song.tracks.forEach((t, i) => {
            if (!t.kind) return;
            this.sounds.setLevel(i, t.level);
            void this.setSound(i, t.sound, false);
        });
        this.update();
        try {
            await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        } finally {
            offInput();
            offStep();
            offMetronome();
            this.seq.stop();
            for (const voices of this.liveVoices.values()) for (const v of voices) v.release();
            for (const t of this.flashTimers.values()) clearTimeout(t);
            clearTimeout(this.sayTimer);
            clearTimeout(this.saveTimer);
            saveSong(this.song);
            this.sounds.dispose();
        }
    }

    /**
     * Switches a track's instrument (page select / SEARCH), stored in the song.
     * `random` (STAR): a random variation of it, temporary: the song keeps the instrument id, a reload brings the original back.
     */
    async setSound(track: number, id: string, announce = true, random = false): Promise<void> {
        const t = this.song.tracks[track];
        if (!t.kind) return;
        const def = findInstrument(soundsFor(t.kind), id);
        const loading = this.sounds.set(track, t.kind, def.id, random);
        if (!random) {
            t.sound = def.id;
            this.saveSoon();
        }
        this.update();
        try {
            const name = await loading;
            devlog('event', { app: 'muop', line: `sound T${track + 1}: ${random ? 'random ' : ''}${name}` });
            if (announce) this.say(`${this.label(track)}\n${random ? 'Random: ' : ''}${name}`);
        } catch (error) {
            this.say(`Sound failed\n${String(error).slice(0, 40)}`);
            devlog('error', { app: 'muop', sound: id, error: String(error) });
        }
    }

    /** Selects a track (SELECT + pad, page). */
    selectTrack(track: number): void {
        this.track = track;
        this.heldStep = null;
        const t = this.cur;
        this.say(t.kind ? `${this.label(track)}\n${findInstrument(soundsFor(t.kind), t.sound).name}` : `${this.label(track)}\nempty`);
        this.update();
    }

    /** Page updates (at most once per animation frame). */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // --- input ---

    private handle(e: InputEvent): void {
        switch (e.type) {
            case 'buttonDown':
                this.buttonDown(e.button);
                break;
            case 'buttonUp':
                if (e.button === 'pattern' && this.tapChain.length > 1) this.say(`Chain ${this.tapChain.map((p) => p + 1).join(' ')}`);
                break;
            case 'padDown':
                this.padDown(e.pad, e.velocity, e.time);
                break;
            case 'padUp':
                this.padUp(e.pad);
                break;
            case 'encoder':
                this.encoder(e.delta);
                break;
            case 'strip':
                this.sounds.setFilter(e.position ? (e.position - 1) / (STRIP_MAX - 1) : null);
                this.drawStrip(e.position);
                break;
            default:
                return;
        }
        this.update();
    }

    private buttonDown(button: string): void {
        const seq = this.seq;
        const shift = this.m.input.isHeld('shift');
        const kind = this.cur.kind;
        if (button === 'search' || button === 'star') {
            if (!kind) return this.say(`${this.label(this.track)}\nempty`);
            if (button === 'star') return void this.setSound(this.track, this.cur.sound, true, true);
            // next sound for the current track, SHIFT = previous
            return void this.setSound(this.track, nextInstrument(soundsFor(kind), this.cur.sound, shift ? -1 : 1).id);
        }
        if (button === 'tap' && shift) {
            return this.say(this.metronome.toggle() ? 'Metronome on' : 'Metronome off');
        }
        switch (button) {
            // shortcuts to the first track of a kind; KEYBOARD steps through the notes tracks (bass ↔ lead)
            case 'pad_mode':
                return this.selectKind('drums');
            case 'chords':
                return this.selectKind('chords');
            case 'keyboard': {
                const notes = this.song.tracks.flatMap((t, i) => (t.kind === 'notes' ? [i] : []));
                if (notes.length) this.selectTrack(notes[(notes.indexOf(this.track) + 1) % notes.length]);
                return;
            }
            case 'step':
                this.stepMode = !this.stepMode;
                return this.say(this.stepMode ? `Steps\n${this.label(this.track)}${kind === 'drums' ? ` ${DRUM_SOUNDS[this.drumSound].name}` : ''}` : 'Play pads');
            case 'play':
                if (seq.playing) seq.pause();
                else seq.start();
                return this.say(seq.playing ? `Play  pattern ${seq.pattern + 1}` : 'Pause');
            case 'stop':
                seq.stop();
                this.step = -1;
                return this.say('Stop');
            case 'rec':
                this.recording = !this.recording;
                return this.say(this.recording ? 'Record' : 'Record off');
            case 'pattern':
                this.tapChain = [];
                return;
        }
    }

    private selectKind(kind: TrackKind): void {
        const i = this.song.tracks.findIndex((t) => t.kind === kind);
        if (i >= 0) this.selectTrack(i);
    }

    private padDown(pad: number, velocity: number, time: number): void {
        const input = this.m.input;
        const pattern = this.song.patterns[this.seq.pattern];
        const steps = pattern.tracks[this.track];
        const kind = this.cur.kind;

        if (input.isHeld('select')) return this.selectTrack(pad);
        if (input.isHeld('pattern')) {
            this.tapChain.push(pad);
            this.seq.setChain(this.tapChain);
            const when = this.seq.playing ? ' (next)' : '';
            return this.say(this.tapChain.length === 1 ? `Pattern ${pad + 1}${when}` : `Chain ${this.tapChain.map((p) => p + 1).join(' ')}${when}`);
        }
        if (input.isHeld('duplicate')) {
            this.song.patterns[pad] = clonePattern(pattern);
            this.saveSoon();
            return this.say(`Copy ${this.seq.pattern + 1} > ${pad + 1}`);
        }
        if (!kind) return;
        if (input.isHeld('erase')) {
            if (kind !== 'drums') {
                steps.notes.fill(null);
                this.say(`Erase\n${this.label(this.track)}`);
            } else if (pad < DRUMS) {
                steps.drums[pad].fill(0);
                this.say(`Erase ${DRUM_SOUNDS[pad].name}`);
            }
            return this.saveSoon();
        }

        const now = this.sounds.ctx.currentTime;
        if (this.stepMode) {
            if (kind === 'drums') {
                const row = steps.drums[this.drumSound];
                row[pad] = row[pad] > 0 ? 0 : 0.8;
                if (row[pad]) this.sounds.drum(this.track, this.drumSound, now, 0.8);
            } else if (steps.notes[pad] === null) {
                steps.notes[pad] = this.pens[this.track];
                this.preview(this.pens[this.track]);
                this.heldStep = { pad, created: true, edited: false };
            } else {
                this.heldStep = { pad, created: false, edited: false };
            }
            return this.saveSoon();
        }

        // live play
        const target: Target = { track: this.track };
        if (kind === 'drums') {
            if (pad >= DRUMS) return;
            this.drumSound = pad;
            this.sounds.drum(this.track, pad, now, velocity);
            target.sound = pad;
            if (this.recording && this.seq.record(target, time, Math.max(0.2, velocity))) this.saveSoon();
        } else {
            this.pens[this.track] = pad;
            for (const v of this.liveVoices.get(pad) ?? []) v.release();
            this.liveVoices.set(pad, this.midis(pad).map((midi) => this.sounds.note(this.track, midi, now, velocity)));
            if (this.recording && this.seq.record(target, time, pad)) this.saveSoon();
            this.say(this.valueName(pad));
        }
        this.flash(pad, this.padColor(pad), 0);
    }

    private padUp(pad: number): void {
        for (const v of this.liveVoices.get(pad) ?? []) v.release();
        this.liveVoices.delete(pad);
        if (!this.flashTimers.has(pad)) this.flashLayer.pad(pad, 'off');

        const held = this.heldStep;
        if (held?.pad === pad) {
            if (!held.created && !held.edited) {
                this.song.patterns[this.seq.pattern].tracks[this.track].notes[pad] = null;
                this.saveSoon();
            }
            this.heldStep = null;
        }
    }

    private encoder(delta: number): void {
        const input = this.m.input;
        const song = this.song;
        const t = this.cur;
        if (input.isHeld('tempo')) {
            song.bpm = clamp(song.bpm + delta, 40, 240);
            this.seq.clock.bpm = song.bpm;
            this.say(`${song.bpm} BPM`);
        } else if (input.isHeld('swing')) {
            song.swing = clamp(song.swing + delta, 50, 75);
            this.seq.clock.swing = song.swing;
            this.say(`Swing ${song.swing}%`);
        } else if (input.isHeld('volume') && input.isHeld('shift')) {
            song.volume = clamp(Math.round((song.volume + delta * 0.02) * 100) / 100, 0, 1);
            this.sounds.volume = song.volume;
            this.say(`Master volume ${Math.round(song.volume * 100)}`);
        } else if (input.isHeld('volume') && t.kind) {
            t.level = clamp(Math.round((t.level + delta * 0.02) * 100) / 100, 0, 1.5);
            this.sounds.setLevel(this.track, t.level);
            this.say(`${this.label(this.track)}\nvolume ${Math.round(t.level * 100)}`);
        } else if (this.heldStep && t.kind && t.kind !== 'drums') {
            const notes = song.patterns[this.seq.pattern].tracks[this.track].notes;
            const [lo, hi] = t.kind === 'chords' ? [0, CHORDS - 1] : [MIN_DEGREE, MAX_DEGREE];
            const value = clamp((notes[this.heldStep.pad] ?? this.pens[this.track]) + delta, lo, hi);
            notes[this.heldStep.pad] = value;
            this.pens[this.track] = value;
            this.heldStep.edited = true;
            this.preview(value);
            this.say(this.valueName(value));
        } else {
            return;
        }
        this.saveSoon();
    }

    // --- notes / chords helpers ---

    /** Midi notes of a value on the current track: a scale degree (notes) or a chord number (chords). */
    private midis(value: number): number[] {
        const t = this.cur;
        return t.kind === 'chords' ? chordNotes(value, t.octave) : [degreeToMidi(value, t.octave)];
    }

    private valueName(value: number): string {
        return this.cur.kind === 'chords' ? chordName(value) : degreeName(value, this.cur.octave);
    }

    private preview(value: number): void {
        const now = this.sounds.ctx.currentTime;
        for (const midi of this.midis(value)) this.sounds.note(this.track, midi, now, 0.8, 0.15);
    }

    private label(track: number): string {
        return `T${track + 1} ${this.song.tracks[track].name}`;
    }

    // --- output ---

    /** PATTERN / DUPLICATE held: the pads show the patterns. */
    private modifierView(): boolean {
        return this.m.input.isHeld('pattern') || this.m.input.isHeld('duplicate');
    }

    /** SELECT held: the pads show the tracks. */
    private trackView(): boolean {
        return this.m.input.isHeld('select');
    }

    /** Color of a pad when played on the current track. */
    private padColor(pad: number): Color {
        const kind = this.cur.kind;
        return kind === 'drums' ? DRUM_SOUNDS[pad]?.color ?? 'white' : kind === 'chords' ? noteColor(chordRoot(pad)) : noteColor(pad);
    }

    private cells(): Cell[] {
        const song = this.song;
        const steps = song.patterns[this.seq.pattern].tracks[this.track];
        const input = this.m.input;
        const kind = this.cur.kind;
        const all = (f: (i: number) => Cell) => Array.from({ length: 16 }, (_, i) => f(i));

        if (this.trackView()) {
            return song.tracks.map((t, i) => (i === this.track ? { color: 'white', level: 3 } : t.kind ? { color: trackColor(t), level: 1 } : OFF));
        }
        if (this.modifierView()) {
            const chain = this.seq.pendingChain ?? song.chain;
            return song.patterns.map((p, i) =>
                i === this.seq.pattern ? { color: 'white', level: 3 }
                : chain.includes(i) ? { color: 'green', level: 2 }
                : !isEmptyPattern(p) ? { color: 'blue', level: 1 }
                : OFF,
            );
        }
        if (!kind) return all(() => OFF);
        if (input.isHeld('erase') && kind === 'drums') {
            return all((i) => (i < DRUMS && steps.drums[i].some((v) => v > 0) ? { color: DRUM_SOUNDS[i].color, level: 1 } : OFF));
        }
        if (this.stepMode) {
            return all((s): Cell => {
                if (kind === 'drums') {
                    const v = steps.drums[this.drumSound][s];
                    if (v > 0) return { color: DRUM_SOUNDS[this.drumSound].color, level: v > 0.66 ? 3 : v > 0.33 ? 2 : 1 };
                } else {
                    const n = steps.notes[s];
                    if (n !== null) return { color: kind === 'chords' ? noteColor(chordRoot(n)) : noteColor(n), level: 3 };
                }
                return s % 4 === 0 ? { color: 'white', level: 1 } : OFF;
            });
        }
        if (kind === 'drums') return all((i) => (i < DRUMS ? { color: DRUM_SOUNDS[i].color, level: i === this.drumSound ? 2 : 1 } : OFF));
        if (kind === 'chords') return all((i) => ({ color: noteColor(chordRoot(i)), level: 1 }));
        return all((i) => ({ color: i % 7 === 0 ? 'orange' : 'blue', level: 1 }));
    }

    /** Redraws the lights and notifies the page. */
    private update(): void {
        const l = this.m.lights;
        const cells = this.cells();
        cells.forEach((c, i) => this.grid.pad(i, c.color, c.level));

        this.playhead.clear();
        const showHead = this.stepMode && this.seq.playing && this.step >= 0 && !this.modifierView() && !this.trackView();
        if (showHead) this.playhead.pad(this.step, 'white', 3);

        const input = this.m.input;
        const kind = this.cur.kind;
        const beat = this.seq.playing && this.step % 4 === 0;
        l.button('pad_mode', kind === 'drums' ? 4 : 1);
        l.button('keyboard', kind === 'notes' ? 4 : 1);
        l.button('chords', kind === 'chords' ? 4 : 1);
        l.button('step', this.stepMode ? 4 : 1);
        l.button('play', this.seq.playing ? (beat ? 4 : 2) : 1);
        l.button('rec', this.recording ? 4 : 1);
        l.button('stop', 1);
        l.button('shift', input.isHeld('shift') ? 4 : 1);
        l.button('tap', this.metronome.enabled ? (beat ? 4 : 2) : 1);
        l.button('search', input.isHeld('search') ? 4 : 1);
        l.button('star', this.sounds.isRandom(this.track) ? 3 : input.isHeld('star') ? 4 : 1);
        for (const b of MODIFIERS) l.button(b, input.isHeld(b) ? 4 : 1);
        l.flush();

        if (showHead) cells[this.step] = { color: 'white', level: 3 };
        this.view = this.makeView(cells);
        this.notify();
    }

    /** Lights a pad on the top layer; ms = 0 keeps it until padUp. */
    private flash(pad: number, color: Color, ms = 90): void {
        clearTimeout(this.flashTimers.get(pad));
        this.flashTimers.delete(pad);
        this.flashLayer.pad(pad, color, 3);
        if (ms > 0) {
            this.flashTimers.set(
                pad,
                setTimeout(() => {
                    this.flashTimers.delete(pad);
                    if (!this.m.input.isPadHeld(pad)) {
                        this.flashLayer.pad(pad, 'off');
                        this.m.lights.flush();
                    }
                }, ms),
            );
        }
    }

    /** Touch strip: filter amount as a bar. */
    private drawStrip(position: number): void {
        const lit = position ? Math.round(((position - 1) / (STRIP_MAX - 1)) * (STRIP_LEDS - 1)) : -1;
        for (let i = 0; i < STRIP_LEDS; i++) this.m.lights.strip(i, i <= lit ? 'cyan' : 'off', i === lit ? 3 : 1);
    }

    /** Display text (debounced: a frame costs ~80 ms on the wire). */
    private say(text: string): void {
        this.message = text;
        devlog('event', { app: 'muop', line: text.replace('\n', ' · ') });
        clearTimeout(this.sayTimer);
        this.sayTimer = setTimeout(() => this.m.screen.set(text), 30);
    }

    private saveSoon(): void {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => saveSong(this.song), 500);
    }

    private makeView(cells: Cell[] = this.cells()): MuOpView {
        return {
            track: this.track,
            tracks: this.song.tracks.map((t, i) => ({ name: t.name, kind: t.kind, sound: t.sound, level: t.level, octave: t.octave, random: this.sounds.isRandom(i) })),
            stepMode: this.stepMode,
            drumSound: this.drumSound,
            pen: this.pens[this.track],
            playing: this.seq.playing,
            recording: this.recording,
            metronome: this.metronome.enabled,
            pattern: this.seq.pattern,
            chain: [...this.song.chain],
            pendingChain: this.seq.pendingChain && [...this.seq.pendingChain],
            bpm: this.song.bpm,
            swing: this.song.swing,
            volume: this.song.volume,
            step: this.step,
            cells,
            message: this.message,
        };
    }

    private notify(): void {
        if (this.notifyQueued) return;
        this.notifyQueued = true;
        requestAnimationFrame(() => {
            this.notifyQueued = false;
            for (const l of this.listeners) l();
        });
    }
}
