// μOp controller: device input → song edits / playback, song state → pad + button lights + display.
// The page reads `view` (subscribe()); the device is the main instrument.
// Everything (pads, STEP, REC, ERASE, SEARCH, STAR, VOLUME) acts on the selected track (SELECT + pad).
import { LED_BUTTONS, STRIP_LEDS, STRIP_MAX, type Color, type InputEvent, type LedButton, type MaschineMikroMk3 } from '../../maschine';
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
    type FxHit,
    type Song,
    type PatternTrack,
    type Track,
    type TrackKind,
} from './model';
import { Sequencer, fxKey, type Target } from './sequencer';
import { FX, isTrackFx } from './fx';
import { devlog } from '../../dev/devlog';
import { Metronome } from '../../engine/metronome';
import { DRUM_SOUNDS, soundsFor, type Sounds } from './sounds';
import { findInstrument, nextInstrument, type Voice } from '../../engine/instruments';
import { Pages, type Cell, type Help, type Page } from './page';
import { History } from './history';

export type { Cell, Help } from './page';

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
    /** Punch-in FX active now (held + recorded on the current step), names. */
    fx: string[];
    /** The button held last (for the help on the page), null = none. */
    held: LedButton | null;
}

type Layer = ReturnType<MaschineMikroMk3['lights']['layer']>;

const OFF: Cell = { color: 'off', level: 0 };
const NOTE_COLORS: Color[] = ['orange', 'yellow', 'lime', 'green', 'cyan', 'blue', 'violet'];
export const noteColor = (degree: number): Color => NOTE_COLORS[((degree % 7) + 7) % 7];
/** Track color by kind (bass = notes an octave down: blue). */
export const trackColor = (t: Pick<Track, 'kind' | 'octave'>): Color =>
    t.kind === 'drums' ? 'red' : t.kind === 'chords' ? 'violet' : t.kind === 'notes' ? (t.octave < 0 ? 'blue' : 'green') : 'off';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pct = (v: number) => String(Math.round(v * 100));

/** Cheat sheet rows that aren't pages (before / after the generated page rows). */
const HELP_TOP: Help[] = [
    { keys: 'Hold a lit button', text: 'Its page while held: pads / encoder / < > that do something are lit, the display shows the value. Release = back to playing' },
    { keys: 'PAD MODE / KEYBOARD / CHORDS', text: 'Shortcuts: drums track · bass ↔ lead · chords track' },
    { keys: 'Pads', text: 'Play. Drums: pads 1–8 (selects the sound). Bass / lead: A minor scale over 16 pads. Chords: pads 1–8 triads (Am B° C Dm Em F G Am), 9–16 the same as 7th chords' },
    { keys: 'STEP', text: 'Pads = 16 steps. Drums: tap toggles the selected sound. Notes / chords: tap writes the last played note / chord, tap again clears, hold + encoder changes it' },
    { keys: 'PLAY / STOP / REC', text: 'Play/pause · stop and rewind · live recording into the nearest step while playing' },
    { keys: 'RESTART', text: 'Play from the start of the current pattern right away (a queued pattern / chain starts right away instead)' },
];
const HELP_BOTTOM: Help[] = [
    { keys: 'Touch strip', text: 'Low-pass filter while touched' },
    { keys: 'STAR', text: "Random variation of the current track's sound: temporary, not saved (STAR lit while active, SEARCH or a reload goes back)" },
    { keys: 'Button lights', text: 'Dim = usable, bright = active / held. While a page is held, only what it uses stays lit' },
];

export class MuOpController {
    view: MuOpView;

    private seq: Sequencer;
    private pages: Pages;
    private history: History;
    /** SHIFT + Copy: one track's steps of a pattern. */
    private clipboard: { kind: TrackKind; steps: PatternTrack } | null = null;
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
    /** Pads held as punch-in FX (PERFORM + pad), released on padUp even after PERFORM was let go. */
    private fxPads = new Map<number, FxHit>();
    /** FX active on the last played step (recorded + live), for the lights / page. */
    private stepFx: FxHit[] = [];
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
        this.history = new History(song);
        this.seq.onEdit = (pattern) => {
            this.history.edit(pattern);
            this.saveSoon();
        };
        this.pages = new Pages(MuOpController.definePages(this), (text) => this.say(text));
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
                this.stepFx = s.fx;
                if (!this.stepMode && !this.pages.active?.cells) {
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

    /** The Controls cheat sheet (no device needed). */
    static controls(): Help[] {
        const pages = new Pages(MuOpController.definePages(null as unknown as MuOpController), () => {});
        return [...HELP_TOP, ...pages.help(), ...HELP_BOTTOM];
    }

    // --- pages (hold a button) ---

    /**
     * The pages. `c` is only used inside the callbacks (never while building), so `controls()` can build them
     * without a controller for the cheat sheet.
     */
    private static definePages(c: MuOpController): Page[] {
        const held = (b: LedButton) => c.m.input.isHeld(b);

        const select: Page = {
            button: 'select',
            name: 'Select track',
            hint: 'pad = track',
            cells: () => c.song.tracks.map((t, i) => (i === c.track ? { color: 'white', level: 3 } : t.kind ? { color: trackColor(t), level: 1 } : OFF)),
            padDown: (pad) => c.selectTrack(pad),
            help: [{ keys: 'SELECT + pad', text: 'Select track 1–16 (pads show the tracks, selected = white). Everything else acts on the selected track' }],
        };

        const pattern: Page = {
            button: 'pattern',
            name: 'Pattern',
            hint: 'pad = select, more = chain',
            open: () => {
                c.tapChain = [];
            },
            close: () => {
                if (c.tapChain.length > 1) c.say(`Chain ${c.tapChain.map((p) => p + 1).join(' ')}`);
            },
            cells: () => c.patternCells(),
            padDown: (pad) => {
                c.tapChain.push(pad);
                c.seq.setChain(c.tapChain);
                const when = c.seq.playing ? ' (next)' : '';
                c.say(c.tapChain.length === 1 ? `Pattern ${pad + 1}${when}` : `Chain ${c.tapChain.map((p) => p + 1).join(' ')}${when}`);
            },
            help: [
                {
                    keys: 'PATTERN + pad',
                    text: 'Select pattern (switches at the end of the bar while playing). Tap several pads while holding = chain. Pads: current = white, in the chain = green, used = blue',
                },
            ],
        };

        const duplicate: Page = {
            button: 'duplicate',
            name: 'Duplicate',
            hint: 'pad = copy pattern to',
            cells: () => c.patternCells(),
            padDown: (pad) => {
                c.history.edit(pad);
                c.song.patterns[pad] = clonePattern(c.song.patterns[c.seq.pattern]);
                c.saveSoon();
                c.say(`Copy ${c.seq.pattern + 1} > ${pad + 1}`);
            },
            help: [{ keys: 'DUPLICATE + pad', text: 'Copy the current pattern there' }],
        };

        const erase: Page = {
            button: 'erase',
            name: 'Erase',
            hint: 'pad = clear',
            modifier: true,
            buttons: ['perform'],
            cells: () => {
                const steps = c.song.patterns[c.seq.pattern].tracks[c.track];
                if (c.cur.kind !== 'drums') return c.playCells();
                return Array.from({ length: 16 }, (_, i) => (i < DRUMS && steps.drums[i].some((v) => v > 0) ? { color: DRUM_SOUNDS[i].color, level: 1 } : OFF));
            },
            padDown: (pad) => {
                const kind = c.cur.kind;
                const steps = c.song.patterns[c.seq.pattern].tracks[c.track];
                if (!kind || (kind === 'drums' && pad >= DRUMS)) return;
                c.history.edit(c.seq.pattern);
                if (kind !== 'drums') {
                    steps.notes.fill(null);
                    c.say(`Erase\n${c.label(c.track)}`);
                } else if (pad < DRUMS) {
                    steps.drums[pad].fill(0);
                    c.say(`Erase ${DRUM_SOUNDS[pad].name}`);
                }
                c.saveSoon();
            },
            help: [{ keys: 'ERASE + pad', text: 'Clear that drum sound (pads show the used ones). Notes / chords track: any pad clears the track in this pattern' }],
        };

        const tempo: Page = {
            button: 'tempo',
            name: 'Tempo',
            params: [
                {
                    name: 'Tempo',
                    help: 'Tempo 40–240 BPM',
                    value: () => `${c.song.bpm} BPM`,
                    step: (d) => {
                        c.song.bpm = clamp(c.song.bpm + d, 40, 240);
                        c.seq.clock.bpm = c.song.bpm;
                        c.saveSoon();
                    },
                },
            ],
        };

        const swing: Page = {
            button: 'swing',
            name: 'Swing',
            params: [
                {
                    name: 'Swing',
                    help: 'Swing 50–75 %',
                    value: () => `${c.song.swing}%`,
                    step: (d) => {
                        c.song.swing = clamp(c.song.swing + d, 50, 75);
                        c.seq.clock.swing = c.song.swing;
                        c.saveSoon();
                    },
                },
            ],
        };

        const volume: Page = {
            button: 'volume',
            name: 'Volume',
            params: [
                {
                    name: 'Track',
                    help: 'Volume of the current track (saved in the song)',
                    value: () => (c.cur.kind ? `${pct(c.cur.level)}  T${c.track + 1}` : '–'),
                    step: (d) => {
                        const t = c.cur;
                        if (!t.kind) return;
                        t.level = clamp(Math.round((t.level + d * 0.02) * 100) / 100, 0, 1.5);
                        c.sounds.setLevel(c.track, t.level);
                        c.saveSoon();
                    },
                },
                {
                    name: 'Master',
                    help: 'master volume',
                    value: () => pct(c.song.volume),
                    step: (d) => {
                        c.song.volume = clamp(Math.round((c.song.volume + d * 0.02) * 100) / 100, 0, 1);
                        c.sounds.volume = c.song.volume;
                        c.saveSoon();
                    },
                },
            ],
        };

        const search: Page = {
            button: 'search',
            name: 'Sound',
            params: [
                {
                    name: 'Sound',
                    help: 'Browse the sounds of the current track (also selectable in the track list)',
                    value: () => (c.cur.kind ? findInstrument(soundsFor(c.cur.kind), c.cur.sound).name : 'empty track'),
                    step: (d) => {
                        const kind = c.cur.kind;
                        if (!kind) return;
                        let id = c.cur.sound;
                        for (let i = 0; i < Math.abs(d); i++) id = nextInstrument(soundsFor(kind), id, Math.sign(d)).id;
                        void c.setSound(c.track, id, false);
                    },
                },
            ],
            tap: {
                name: 'Next sound for the current track',
                run: () => {
                    const kind = c.cur.kind;
                    if (!kind) return c.say(`${c.label(c.track)}\nempty`);
                    void c.setSound(c.track, nextInstrument(soundsFor(kind), c.cur.sound, 1).id);
                },
            },
        };

        // via the prototype: `c` is null when building the cheat sheet (shiftFunctions only uses `this` in callbacks)
        const fns = MuOpController.prototype.shiftFunctions.call(c);
        const shift: Page = {
            button: 'shift',
            name: 'Shift',
            hint: 'pad = function',
            modifier: true,
            buttons: ['tap'],
            cells: () => fns.map((f) => (f.run && f.available() ? { color: f.color, level: 1 } : OFF)),
            padDown: (pad) => {
                const f = fns[pad];
                if (!f.run || !f.available()) return c.say(`${f.name}\n${f.run ? 'nothing to do' : 'later'}`);
                c.flash(pad, 'white');
                f.run();
            },
            help: [
                {
                    keys: 'SHIFT + pad',
                    text: `The functions printed on the pads (pads stay silent, usable ones lit): ${fns.map((f, i) => `${i + 1} ${f.name}${f.run ? '' : ' (later)'}`).join(' · ')}`,
                },
                {
                    keys: 'SHIFT + pad 1–16',
                    text: 'Undo / Redo = a whole gesture (everything while something was held, or a recording pass); Step undo / redo = one edit. Nudge moves the track one step (STEP mode on drums: only the selected sound). Clear = the track in this pattern, Clear auto = the recorded FX. Copy / Paste = the track’s steps (into a track of the same kind). Octave = the track’s octave',
                },
                { keys: 'SHIFT + TAP', text: 'Metronome on/off (TAP blinks on the beat while on)' },
            ],
        };

        const perform: Page = {
            button: 'perform',
            name: 'Perform FX',
            hint: 'pad = FX',
            buttons: ['erase', 'rec'],
            open: () => {
                if (!held('erase')) return;
                c.history.edit(c.seq.pattern);
                for (const hits of c.song.patterns[c.seq.pattern].fx) hits.length = 0;
                c.saveSoon();
                c.say(`Erase FX\npattern ${c.seq.pattern + 1}`);
            },
            cells: () => {
                const active = c.activeFx();
                return FX.map((def, i) =>
                    active.some((h) => h.fx === i && (h.track === undefined || h.track === c.track)) ? { color: 'white', level: 3 } : { color: def.color, level: 1 },
                );
            },
            padDown: (pad) => c.fxDown(pad),
            help: [
                {
                    keys: 'PERFORM + pad',
                    text: 'Punch-in FX while held (pads show the FX, active = white). Pads 1–8 act on the selected track, 9–16 on the whole mix. Release PERFORM first to keep it until the pad is let go. PERFORM lit while an FX runs',
                },
                { keys: 'REC + PERFORM + pad', text: "While playing: the FX is recorded into the pattern's steps and comes back every loop" },
                { keys: 'ERASE + PERFORM', text: 'Clear all recorded FX of the current pattern (ERASE + PERFORM + pad: only that FX)' },
            ],
        };

        return [select, pattern, duplicate, erase, perform, tempo, swing, volume, search, shift];
    }

    // --- input ---

    private handle(e: InputEvent): void {
        if (this.pages.handle(e)) return this.update();
        switch (e.type) {
            case 'buttonDown':
                this.buttonDown(e.button);
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
        if (button === 'star') {
            if (!kind) return this.say(`${this.label(this.track)}\nempty`);
            return void this.setSound(this.track, this.cur.sound, true, true);
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
            case 'restart':
                seq.restart();
                return this.say(`Restart  pattern ${seq.pattern + 1}`);
            case 'stop':
                seq.stop();
                this.step = -1;
                return this.say('Stop');
            case 'rec':
                this.recording = !this.recording;
                seq.recordFx = this.recording;
                return this.say(this.recording ? 'Record' : 'Record off');
        }
    }

    private selectKind(kind: TrackKind): void {
        const i = this.song.tracks.findIndex((t) => t.kind === kind);
        if (i >= 0) this.selectTrack(i);
    }

    /** Pads when no page took them: play, or steps in STEP mode. */
    private padDown(pad: number, velocity: number, time: number): void {
        const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
        const kind = this.cur.kind;
        if (!kind) return;

        const now = this.sounds.ctx.currentTime;
        if (this.stepMode) {
            if (kind === 'drums') {
                this.history.edit(this.seq.pattern);
                const row = steps.drums[this.drumSound];
                row[pad] = row[pad] > 0 ? 0 : 0.8;
                if (row[pad]) this.sounds.drum(this.track, this.drumSound, now, 0.8);
            } else if (steps.notes[pad] === null) {
                this.history.edit(this.seq.pattern);
                steps.notes[pad] = this.pens[this.track];
                this.preview(this.pens[this.track]);
                this.heldStep = { pad, created: true, edited: false };
                this.say(`Step ${pad + 1}\n${this.valueName(this.pens[this.track])}`);
            } else {
                this.heldStep = { pad, created: false, edited: false };
                this.say(`Step ${pad + 1}\n${this.valueName(steps.notes[pad]!)}`);
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

    /** PERFORM + pad: FX on while held (pads 1–8 on the selected track, 9–16 global). ERASE held: clear it instead. */
    private fxDown(pad: number): void {
        const def = FX[pad];
        const hit: FxHit = isTrackFx(pad) ? { fx: pad, track: this.track } : { fx: pad };
        if (hit.track !== undefined && !this.cur.kind) return this.say(`${this.label(this.track)}\nempty`);
        const where = hit.track !== undefined ? ` · ${this.label(this.track)}` : '';
        if (this.m.input.isHeld('erase')) {
            for (const hits of this.song.patterns[this.seq.pattern].fx) {
                const keep = hits.filter((h) => !(h.fx === hit.fx && h.track === hit.track));
                hits.splice(0, hits.length, ...keep);
            }
            this.saveSoon();
            return this.say(`Erase FX\n${def.name}${where}`);
        }
        this.fxPads.set(pad, hit);
        this.seq.liveFx.set(fxKey(hit), hit);
        // global FX start right away (while playing the sequencer keeps them in step from the next step on)
        if (def.global) this.sounds.fx.engage(def.global, this.sounds.ctx.currentTime, this.seq.clock.stepDuration);
        this.say(`FX ${def.name}${where}${this.recording && this.seq.playing ? ' (rec)' : ''}`);
    }

    private fxUp(pad: number): void {
        const hit = this.fxPads.get(pad)!;
        this.fxPads.delete(pad);
        this.seq.liveFx.delete(fxKey(hit));
        const id = FX[pad].global;
        if (id) this.sounds.fx.release(id, this.sounds.ctx.currentTime);
    }

    private padUp(pad: number): void {
        if (this.fxPads.has(pad)) this.fxUp(pad);
        for (const v of this.liveVoices.get(pad) ?? []) v.release();
        this.liveVoices.delete(pad);
        if (!this.flashTimers.has(pad)) this.flashLayer.pad(pad, 'off');

        const held = this.heldStep;
        if (held?.pad === pad) {
            if (!held.created && !held.edited) {
                this.history.edit(this.seq.pattern);
                this.song.patterns[this.seq.pattern].tracks[this.track].notes[pad] = null;
                this.saveSoon();
                this.say(`Step ${pad + 1}\ncleared`);
            }
            this.heldStep = null;
        }
    }

    /** Encoder when no page took it: edits the held step (STEP mode, notes / chords). */
    private encoder(delta: number): void {
        const t = this.cur;
        if (this.heldStep && t.kind && t.kind !== 'drums') {
            const notes = this.song.patterns[this.seq.pattern].tracks[this.track].notes;
            const [lo, hi] = t.kind === 'chords' ? [0, CHORDS - 1] : [MIN_DEGREE, MAX_DEGREE];
            const value = clamp((notes[this.heldStep.pad] ?? this.pens[this.track]) + delta, lo, hi);
            this.history.edit(this.seq.pattern);
            this.song.patterns[this.seq.pattern].tracks[this.track].notes[this.heldStep.pad] = value;
            this.pens[this.track] = value;
            this.heldStep.edited = true;
            this.preview(value);
            this.say(`Step ${this.heldStep.pad + 1}\n${this.valueName(value)}`);
        } else {
            return;
        }
        this.saveSoon();
    }

    // --- SHIFT + pad functions ---

    /** The functions printed on the pads (index = pad). No `run` = not there yet. */
    private shiftFunctions(): { name: string; color: Color; run?: () => void; available: () => boolean }[] {
        const always = () => true;
        const hasKind = () => !!this.cur.kind;
        const later = (name: string) => ({ name, color: 'off' as Color, available: always });
        return [
            { name: 'Undo', color: 'orange', run: () => this.undo(false, false), available: () => this.history.canUndo },
            { name: 'Redo', color: 'orange', run: () => this.undo(true, false), available: () => this.history.canRedo },
            { name: 'Step undo', color: 'yellow', run: () => this.undo(false, true), available: () => this.history.canUndo },
            { name: 'Step redo', color: 'yellow', run: () => this.undo(true, true), available: () => this.history.canRedo },
            later('Quantize'),
            later('Quantize 50%'),
            { name: 'Nudge <', color: 'cyan', run: () => this.nudge(-1), available: hasKind },
            { name: 'Nudge >', color: 'cyan', run: () => this.nudge(1), available: hasKind },
            { name: 'Clear', color: 'red', run: () => this.clearTrack(), available: hasKind },
            {
                name: 'Clear auto',
                color: 'red',
                run: () => this.clearFx(),
                available: () => this.song.patterns[this.seq.pattern].fx.some((hits) => hits.length > 0),
            },
            { name: 'Copy', color: 'green', run: () => this.copyTrack(), available: hasKind },
            { name: 'Paste', color: 'green', run: () => this.pasteTrack(), available: () => !!this.clipboard && this.clipboard.kind === this.cur.kind },
            later('Semitone -'),
            later('Semitone +'),
            { name: 'Octave -', color: 'blue', run: () => this.octave(-1), available: () => !!this.cur.kind && this.cur.kind !== 'drums' },
            { name: 'Octave +', color: 'blue', run: () => this.octave(1), available: () => !!this.cur.kind && this.cur.kind !== 'drums' },
        ];
    }

    /** Undo / redo: `step` = one edit, else the whole gesture. */
    private undo(redo: boolean, step: boolean): void {
        const n = redo ? this.history.redo(!step) : this.history.undo(!step);
        const what = `${step ? 'Step ' : ''}${redo ? 'redo' : 'undo'}`;
        this.heldStep = null;
        this.saveSoon();
        this.say(`${what[0].toUpperCase()}${what.slice(1)}\n${n === 1 ? '1 edit' : `${n} edits`}`);
    }

    /** Rotates the current track one step (drums in STEP mode: the selected sound only). */
    private nudge(dir: 1 | -1): void {
        const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
        const rotate = <T>(a: T[]) => (dir > 0 ? a.unshift(a.pop()!) : a.push(a.shift()!));
        this.history.edit(this.seq.pattern);
        const one = this.cur.kind === 'drums' && this.stepMode;
        if (this.cur.kind === 'drums') {
            if (one) rotate(steps.drums[this.drumSound]);
            else steps.drums.forEach(rotate);
        } else rotate(steps.notes);
        this.saveSoon();
        this.say(`Nudge ${dir > 0 ? '>' : '<'}\n${one ? DRUM_SOUNDS[this.drumSound].name : this.label(this.track)}`);
    }

    private clearTrack(): void {
        const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
        this.history.edit(this.seq.pattern);
        steps.notes.fill(null);
        for (const row of steps.drums) row.fill(0);
        this.saveSoon();
        this.say(`Clear\n${this.label(this.track)}`);
    }

    private clearFx(): void {
        this.history.edit(this.seq.pattern);
        for (const hits of this.song.patterns[this.seq.pattern].fx) hits.length = 0;
        this.saveSoon();
        this.say(`Clear auto\nFX pattern ${this.seq.pattern + 1}`);
    }

    private copyTrack(): void {
        const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
        this.clipboard = { kind: this.cur.kind!, steps: { drums: steps.drums.map((row) => [...row]), notes: [...steps.notes] } };
        this.say(`Copy\n${this.label(this.track)} P${this.seq.pattern + 1}`);
    }

    private pasteTrack(): void {
        const clip = this.clipboard!;
        this.history.edit(this.seq.pattern);
        this.song.patterns[this.seq.pattern].tracks[this.track] = { drums: clip.steps.drums.map((row) => [...row]), notes: [...clip.steps.notes] };
        this.saveSoon();
        this.say(`Paste\n${this.label(this.track)} P${this.seq.pattern + 1}`);
    }

    private octave(dir: 1 | -1): void {
        const t = this.cur;
        t.octave = clamp(t.octave + dir, -3, 3);
        this.saveSoon();
        this.say(`${this.label(this.track)}\noctave ${t.octave > 0 ? '+' : ''}${t.octave}`);
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

    /** FX running now: held pads + recorded on the current step (while playing). */
    private activeFx(): FxHit[] {
        const live = [...this.fxPads.values()];
        const recorded = this.seq.playing ? this.stepFx.filter((h) => !live.some((l) => l.fx === h.fx && l.track === h.track)) : [];
        return [...live, ...recorded];
    }

    /** Color of a pad when played on the current track. */
    private padColor(pad: number): Color {
        const kind = this.cur.kind;
        return kind === 'drums' ? DRUM_SOUNDS[pad]?.color ?? 'white' : kind === 'chords' ? noteColor(chordRoot(pad)) : noteColor(pad);
    }

    /** What the pads show: the held page's view, else the play / step view. */
    private cells(): Cell[] {
        return this.pages.active?.cells?.() ?? this.playCells();
    }

    /** PATTERN / DUPLICATE: current = white, in the chain = green, used = blue. */
    private patternCells(): Cell[] {
        const chain = this.seq.pendingChain ?? this.song.chain;
        return this.song.patterns.map((p, i) =>
            i === this.seq.pattern ? { color: 'white', level: 3 }
            : chain.includes(i) ? { color: 'green', level: 2 }
            : !isEmptyPattern(p) ? { color: 'blue', level: 1 }
            : OFF,
        );
    }

    /** Play view (sounds / notes / chords) or the steps in STEP mode. */
    private playCells(): Cell[] {
        const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
        const kind = this.cur.kind;
        const all = (f: (i: number) => Cell) => Array.from({ length: 16 }, (_, i) => f(i));

        if (!kind) return all(() => OFF);
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
        const showHead = this.stepMode && this.seq.playing && this.step >= 0 && !this.pages.active?.cells;
        if (showHead) this.playhead.pad(this.step, 'white', 3);
        // the display stays on while a page button or a step is held, blanks 3 s after release
        this.m.screen.hold(!!this.pages.active || !!this.heldStep);
        if (!this.recording && !this.m.input.heldButtons.length && !this.m.input.heldPads.length) this.history.close();

        // 1 = usable, more = a state; page buttons and the held page's view are applied by `pages.lights()`
        const input = this.m.input;
        const kind = this.cur.kind;
        const beat = this.seq.playing && this.step % 4 === 0;
        const levels = new Map<LedButton, number>([
            ['pad_mode', kind === 'drums' ? 4 : 1],
            ['keyboard', kind === 'notes' ? 4 : 1],
            ['chords', kind === 'chords' ? 4 : 1],
            ['step', this.stepMode ? 4 : 1],
            ['play', this.seq.playing ? (beat ? 4 : 2) : 1],
            ['rec', this.recording ? 4 : 1],
            ['stop', 1],
            ['restart', 1],
            ['tap', this.metronome.enabled ? (beat ? 4 : 2) : 1],
            ['star', this.sounds.isRandom(this.track) ? 3 : input.isHeld('star') ? 4 : 1],
            ['perform', this.activeFx().length ? 3 : 1],
        ]);
        const lit = this.pages.lights(levels, (b) => input.isHeld(b));
        for (const b of LED_BUTTONS) l.button(b, lit.get(b) ?? 0);
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
            held: (this.m.input.heldButtons.filter((b): b is LedButton => b !== 'enc-push' && b !== 'enc-touched').pop() ?? null),
            fx: this.activeFx().map((h) => `${FX[h.fx].name}${h.track !== undefined ? ` (T${h.track + 1})` : ''}`),
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
