// μOp controller: device input → song edits / playback, song state → pad + button lights + display.
// The page reads `view` (subscribe()); the device is the main instrument.
// Everything (pads, STEP, REC, ERASE, SEARCH, STAR, VOLUME) acts on the selected track (SELECT + pad).
import { LED_BUTTONS, STRIP_LEDS, STRIP_MAX, type Color, type InputEvent, type LedButton, type MaschineMikroMk3 } from '../../maschine';
import {
    CHORDS,
    DRUMS,
    MAX_DEGREE,
    MIN_DEGREE,
    HARMONY_MODES,
    NOTE_NAMES,
    QUICK_SCALES,
    SCALES,
    VOICINGS,
    chordName,
    chordRoot,
    clonePattern,
    clonePatternTrack,
    audible,
    MAX_LENGTH,
    findScale,
    isEmptyPattern,
    keyName,
    midiName,
    scaleLength,
    saveSong,
    type FxHit,
    type Song,
    KINDS,
    RATES,
    STEPS,
    kindName,
    rateName,
    type PatternTrack,
    type Track,
    type TrackKind,
    type TrackMidi,
} from './model';
import { Sequencer, fxKey, type Target } from './sequencer';
import { FX, isTrackFx } from './fx';
import { devlog } from '../../dev/devlog';
import { Metronome } from '../../engine/metronome';
import { DRUM_SOUNDS, soundsFor, type Sounds } from './sounds';
import { findInstrument, formatParam, randomParam, stepParam, type ParamDef, type Params, type Voice } from '../../engine/instruments';
import { Pages, TAP_MS, type Cell, type Help, type Page, type Param } from './page';
import { addFavorite, favoriteOf, favorites, indexIn, removeFavorite, soundList, type SoundEntry } from './favorites';
import { History } from './history';
import { Inputs } from './inputs';
import { requestMidi } from '../../engine/midi';
import { harmonyTrack, nextChordWeights, trackMidis } from './harmony';
import { AUTO_BARS, Generator, type GenSettings } from './variation';

export type { Cell, Help } from './page';

export interface TrackView {
    name: string;
    kind: TrackKind | null;
    sound: string;
    level: number;
    octave: number;
    rate: number;
    length: number;
    midi: TrackMidi | null;
    harmony: Track['harmony'];
    voicing: number;
    mute: boolean;
    solo: boolean;
    /** Played by the sequencer (not muted, no other track soloed). */
    audible: boolean;
    /** The favorite (STAR) this track's sound is, null = none. */
    favorite: string | null;
    /** The sound's parameter values (missing = default). */
    params: Params;
}

/** Track settings, changed on the device (SELECT page) or on the app page (track list). */
export type TrackSettings = Partial<Pick<Track, 'name' | 'kind' | 'octave' | 'rate' | 'length' | 'midi' | 'harmony' | 'voicing' | 'level' | 'mute' | 'solo'>>;

export interface MuOpView {
    /** Selected track 0..15. */
    track: number;
    tracks: TrackView[];
    stepMode: boolean;
    drumSound: number;
    /** Value written by step taps on the selected notes / chords track (the last note / chord played). */
    pen: number;
    /** The pen as a note / chord name (with the key and the current chord). */
    penName: string;
    /** Song key, e.g. "A minor". */
    root: number;
    scale: string;
    keyName: string;
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
    /** Song position in clock steps (16ths) while playing, -1 = stopped. */
    tick: number;
    /** Clock steps until all tracks (lengths, clocks) and the bar line up again. */
    cycle: number;
    /** What the pads show (grid + playhead), pad 0 = bottom left. */
    cells: Cell[];
    /** Per pad: what it plays / holds (drum sound, note, chord), '' = nothing. */
    labels: string[];
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
/** Display line 2 on an empty track: how to start it. */
const EMPTY = 'empty';

/** Cheat sheet rows that aren't pages (before / after the generated page rows). */
const HELP_TOP: Help[] = [
    { keys: 'Hold a lit button', text: 'Its page while held: pads / encoder / < > that do something are lit, the display shows the value. Release = back to playing' },
    { keys: 'PAD MODE / KEYBOARD / CHORDS', text: 'Shortcuts: drums track · bass ↔ lead · chords track' },
    { keys: 'Pads', text: 'Play. Drums: pads 1–8 (selects the sound). Notes: the scale of the song key over 16 pads (root = orange); with harmony "follow" the chord tones root / 3rd / 5th going up. Chords: pads 1–8 triads of the key, 9–16 the same as 7th chords; after a chord the likely next chords light brighter (last one = white)' },
    { keys: 'Harmony', text: 'The first chords track leads (its chord holds until the next one). Notes tracks (SELECT page / track list): free = as written, transpose = shifted by the chord root, follow = values are chord tones' },
    { keys: 'STEP', text: 'Pads = 16 steps. Drums: tap toggles the selected sound. Notes / chords: tap writes the last played note / chord, tap again clears' },
    { keys: 'STEP: hold a step', text: 'Notes / chords: < > = Note / Length, encoder changes it. Hold a step + tap a later step = the note lasts up to there. Held-over steps glow dim in the note’s color. The next note cuts a long one (mono style)' },
    { keys: 'REC + pads', text: 'Notes / chords: recorded with the length you hold the pad' },
    { keys: 'STEP (hold)', text: 'Switches to the other view only while held (e.g. pick another drum sound on the play pads), release = back. A short press toggles' },
    { keys: 'PLAY / STOP / REC', text: 'Play/pause · stop and rewind · live recording into the nearest step while playing' },
    { keys: 'RESTART', text: 'Play from the start of the current pattern right away (a queued pattern / chain starts right away instead)' },
];
const HELP_BOTTOM: Help[] = [
    { keys: 'Touch strip', text: 'Low-pass filter while touched' },
    { keys: 'STAR', text: 'Save the current sound (instrument + parameters) as a favorite, for all songs. Favorites come after the instruments in the sound browser (SEARCH, PLUG-IN). STAR lit = the sound is a favorite. Delete them on the app page' },
    { keys: 'Button lights', text: 'Dim = usable, bright = active / held. While a page is held, only what it uses stays lit' },
];

export class MuOpController {
    view: MuOpView;

    private seq: Sequencer;
    private pages: Pages;
    private history: History;
    /** VARIATION: per track generator (settings + déjà vu loops), in memory. */
    private generators = new Map<number, Generator>();
    /** Bars played (for VARIATION auto). */
    private bars = 0;
    /** Song position (clock steps) of the step sounding now. */
    private tick = 0;
    /** Beats since play started, -1 = stopped (idle display: the position). */
    private beats = -1;
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
    /** Per track: its current step (own rate / length), -1 = stopped. */
    private positions: number[] = [];
    private message = 'μOp';
    /** Pattern taps while PATTERN is held (1 tap = select, more = chain). */
    private tapChain: number[] = [];
    /** Notes / chords step held in step mode: encoder edits it; a tap without edit on an existing one clears it. */
    private heldStep: { pad: number; created: boolean; edited: boolean } | null = null;
    private liveVoices = new Map<number, Voice[]>();
    /** Pads held while recording notes: where the hit went (its length is set on release). */
    private recPads = new Map<number, { track: number; at: { pattern: number; step: number } }>();
    /** Held step menu: 0 = note, 1 = length (`< >`), kept between holds. */
    private stepParam = 0;
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
        this.inputs = new Inputs(sounds, () => this.notify());
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
        const offStep = this.seq.onStep((s) => {
            // VARIATION auto: at the last step of a bar, regenerate the next pattern of the tracks that want it
            if (s.step === STEPS - 1) {
                this.bars++;
                for (const [track, g] of this.generators) {
                    if (g.settings.auto && this.bars % g.settings.auto === 0) this.generate(track, this.seq.peekNextPattern(), false);
                }
            }
            this.seq.clock.at(s.time, () => {
                if (s.step % 4 === 0) this.idlePosition(s.pattern, s.tick);
                this.step = s.step;
                this.positions = s.positions;
                this.tick = s.tick;
                this.stepFx = s.fx;
                if (!this.stepMode && !this.pages.active?.cells) {
                    for (const pad of s.pads[this.track]) if (pad >= 0 && pad < 16) this.flash(pad, this.padColor(pad));
                }
                this.update();
            });
        });
        this.say('μOp\nSELECT + pad: track');
        // instruments load in the background (Tone.js is fetched on first use); the pads play as soon as they're ready
        this.song.tracks.forEach((t, i) => {
            if (!t.kind) return;
            this.sounds.setLevel(i, t.level);
            void this.setSound(i, t.sound, false, t.params);
        });
        this.song.tracks.forEach((t, i) => this.sounds.setMidi(i, t.midi));
        if (this.song.tracks.some((t) => t.midi)) void requestMidi();
        void this.inputs.start();
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
            this.inputs.dispose();
            this.sounds.dispose();
        }
    }

    /** Switches a track's instrument with its parameter values (sound browser, track list), stored in the song. */
    async setSound(track: number, id: string, announce = true, params: Params = {}): Promise<void> {
        const t = this.song.tracks[track];
        if (!t.kind) return;
        const def = findInstrument(soundsFor(t.kind), id);
        t.sound = def.id;
        t.params = { ...params };
        const loading = this.sounds.set(track, t.kind, def.id, t.params);
        this.saveSoon();
        this.update();
        try {
            const name = await loading;
            devlog('event', { app: 'muop', line: `sound T${track + 1}: ${name}` });
            if (announce) this.say(`${this.label(track)}\n${this.soundName(track)}`);
        } catch (error) {
            this.say(`Sound failed\n${String(error).slice(0, 40)}`);
            devlog('error', { app: 'muop', sound: id, error: String(error) });
        }
    }

    // --- Sounds: browser, parameters, favorites ---

    /** Audio inputs (USB audio of external synths): app page only (Inputs tab, mixer strip). */
    readonly inputs: Inputs;

    /** Per track: its last edited sound (listed in the browser, so browsing away and back finds it). */
    private edited = new Map<number, { sound: string; params: Params }>();
    /** Per track: the sound before the last randomize (PLUG-IN short press swaps back, A/B). */
    private beforeRandom = new Map<number, Params>();

    private soundEntries(track: number): SoundEntry[] {
        const t = this.song.tracks[track];
        return t.kind ? soundList(t.kind, this.edited.get(track) ?? { sound: t.sound, params: t.params }) : [];
    }

    /** The track's sound as the browser lists it ("Mono lead", "Mono lead (edited)", "★ Mono lead 2"). */
    private soundName(track: number): string {
        const t = this.song.tracks[track];
        if (!t.kind) return EMPTY;
        const list = this.soundEntries(track);
        return list[indexIn(t.kind, list, t.sound, t.params)]?.name ?? findInstrument(soundsFor(t.kind), t.sound).name;
    }

    /** SEARCH / PLUG-IN "Sound": steps through the browser list (wraps). */
    private browse(track: number, delta: number, announce: boolean): void {
        const t = this.song.tracks[track];
        if (!t.kind) return this.say(`${this.label(track)}\n${EMPTY}`);
        const list = this.soundEntries(track);
        let i = indexIn(t.kind, list, t.sound, t.params);
        if (i < 0) i = Math.max(0, list.findIndex((e) => e.sound === t.sound));
        const e = list[(((i + delta) % list.length) + list.length) % list.length];
        void this.setSound(track, e.sound, announce, e.params);
    }

    /** The parameters PLUG-IN shows: the instrument's (drums: the selected drum sound's). */
    private shownParams(): ParamDef[] {
        const kind = this.cur.kind;
        if (!kind) return [];
        const defs = findInstrument(soundsFor(kind), this.cur.sound).params;
        return kind === 'drums' ? defs.filter((d) => d.id.startsWith(`${this.drumSound}.`)) : [...defs];
    }

    private paramValue(def: ParamDef): number {
        return this.cur.params[def.id] ?? def.default;
    }

    /** Changes the track's parameter values (live where the instrument can), saved in the song. */
    private setParams(track: number, params: Params): void {
        const t = this.song.tracks[track];
        if (!t.kind) return;
        t.params = params;
        this.edited.set(track, { sound: t.sound, params: { ...params } });
        this.sounds.tweak(track, t.params);
        this.saveSoon();
        this.update();
    }

    setParam(track: number, def: ParamDef, value: number): void {
        this.setParams(track, { ...this.song.tracks[track].params, [def.id]: value });
    }

    /** PLUG-IN + push (and the sound editor): random values for the shown parameters. */
    randomize(track: number): void {
        const t = this.song.tracks[track];
        if (!t.kind) return this.say(`${this.label(track)}\n${EMPTY}`);
        this.beforeRandom.set(track, { ...t.params });
        const params = { ...t.params };
        for (const def of this.shownParams()) params[def.id] = randomParam(def);
        this.setParams(track, params);
        // hear it: drum kits may be rebuilt (~120 ms), so the drum plays a bit later
        if (t.kind === 'drums') {
            const sound = this.drumSound;
            setTimeout(() => this.sounds.drum(track, sound, this.sounds.ctx.currentTime, 0.8), 250);
        } else if (track === this.track) this.preview(this.pens[track]);
        this.say(`Random\n${t.kind === 'drums' ? DRUM_SOUNDS[this.drumSound].name : this.soundName(track)}`);
    }

    /** PLUG-IN short press (and the sound editor): back to before the last randomize (and forward again). */
    revert(track: number): void {
        const before = this.beforeRandom.get(track);
        if (!before) return this.say('Sound\nnothing to go back to');
        this.beforeRandom.set(track, { ...this.song.tracks[track].params });
        this.setParams(track, before);
        this.say('Sound\nswapped (A/B)');
    }

    /** STAR (and the app page): the track's sound becomes a favorite. */
    saveFavorite(track = this.track): void {
        const t = this.song.tracks[track];
        if (!t.kind) return this.say(`${this.label(track)}\n${EMPTY}`);
        const fav = favoriteOf(t.kind, t.sound, t.params);
        if (fav >= 0) return this.say(`Favorite\n★ ${favorites()[fav].name}`);
        const name = addFavorite(t.kind, t.sound, t.params);
        this.say(`Saved favorite\n★ ${name}`);
        this.update();
    }

    /** App page: deletes a favorite (tracks using that sound keep it, as an edited sound). */
    deleteFavorite(index: number): void {
        const fav = favorites()[index];
        if (!fav) return;
        removeFavorite(index);
        this.say(`Deleted favorite\n${fav.name}`);
        this.update();
    }

    /** Selects a track (SELECT + pad, page). An empty track becomes a notes track with a random sound (kind: SELECT page). */
    selectTrack(track: number, announce = true): void {
        this.track = track;
        this.heldStep = null;
        const t = this.cur;
        if (!announce && t.kind) return this.update();
        if (!t.kind) {
            this.setTrack(track, { kind: 'notes' });
            return this.say(`${this.label(track)}\nnew, random sound`);
        }
        this.say(t.kind ? `${this.label(track)}\n${findInstrument(soundsFor(t.kind), t.sound).name}` : `${this.label(track)}\n${EMPTY}`);
        this.update();
    }

    /** Changes track settings (SELECT page, track list on the app page). Saved in the song. */
    setTrack(track: number, patch: TrackSettings): void {
        const t = this.song.tracks[track];
        const kindChanged = patch.kind !== undefined && patch.kind !== t.kind;
        const wasEmpty = t.kind === null;
        Object.assign(t, patch);
        t.octave = clamp(Math.round(t.octave), -3, 3);
        t.length = clamp(Math.round(t.length), 1, STEPS);
        t.voicing = clamp(Math.round(t.voicing), 0, VOICINGS.length - 1);
        if (!HARMONY_MODES.includes(t.harmony)) t.harmony = 'free';
        if (!RATES.includes(t.rate as (typeof RATES)[number])) t.rate = 1;
        if (kindChanged && t.kind) {
            const defs = soundsFor(t.kind);
            // a new track starts with a random sound, a kind change keeps the sound if it fits
            if (wasEmpty) t.sound = defs[Math.floor(Math.random() * defs.length)].id;
            else if (!defs.some((d) => d.id === t.sound)) t.sound = defs[0].id;
            this.sounds.setLevel(track, t.level);
            void this.setSound(track, t.sound, false);
        }
        if ('midi' in patch) this.sounds.setMidi(track, t.midi);
        if (patch.level !== undefined) {
            t.level = clamp(t.level, 0, 1.5);
            this.sounds.setLevel(track, t.level);
        }
        this.saveSoon();
        this.update();
    }

    /** Song key (CHORDS page, SHIFT + Semitone, app page). Steps keep their scale degrees: the song moves along. */
    setKey(patch: { root?: number; scale?: string }): void {
        if (patch.root !== undefined) this.song.root = ((Math.round(patch.root) % 12) + 12) % 12;
        if (patch.scale !== undefined) this.song.scale = findScale(patch.scale).id;
        this.saveSoon();
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

        /** A setting of the selected track, shown as "value  T3". */
        const setting = (name: string, help: string, show: (t: Track) => string, step: (t: Track, d: number) => TrackSettings | null) => ({
            name,
            help,
            value: () => `${show(c.cur)}  T${c.track + 1}`,
            step: (d: number) => {
                const patch = step(c.cur, Math.sign(d));
                if (patch) c.setTrack(c.track, patch);
            },
        });
        const select: Page = {
            button: 'select',
            name: 'Track',
            params: [
                setting('Kind', 'kind (empty / drums / notes / chords: fills an empty track)', (t) => kindName(t.kind), (t, d) => ({
                    kind: KINDS[clamp(KINDS.indexOf(t.kind) + d, 0, KINDS.length - 1)],
                })),
                setting('Octave', 'octave', (t) => (t.kind === 'drums' ? '–' : `${t.octave > 0 ? '+' : ''}${t.octave}`), (t, d) =>
                    t.kind === 'drums' ? null : { octave: t.octave + d },
                ),
                setting('Clock', 'clock ÷16 … ×2 (steps per 16th)', (t) => rateName(t.rate), (t, d) => ({
                    rate: RATES[clamp(RATES.indexOf(t.rate as (typeof RATES)[number]) + d, 0, RATES.length - 1)],
                })),
                setting('Length', 'length 1–16 steps', (t) => `${t.length} steps`, (t, d) => ({ length: t.length + d })),
                setting('Harmony', 'harmony (notes tracks: free / transpose / follow the chords track)', (t) => (t.kind === 'notes' ? t.harmony : '–'), (t, d) =>
                    t.kind === 'notes' ? { harmony: HARMONY_MODES[clamp(HARMONY_MODES.indexOf(t.harmony) + d, 0, HARMONY_MODES.length - 1)] } : null,
                ),
            ],
            cells: () => c.song.tracks.map((t, i) => (i === c.track ? { color: 'white', level: 3 } : t.kind ? { color: trackColor(t), level: 1 } : OFF)),
            padDown: (pad) => c.selectTrack(pad),
            help: [
                { keys: 'SELECT + pad', text: 'Select track 1–16 (pads show the tracks, selected = white). Everything else acts on the selected track. An empty track becomes a notes track with a random sound (change the kind with < > + encoder)' },
                { keys: 'App page', text: 'Track list: the same settings, plus the track name and MIDI out (port + channel; the track then plays on the external gear instead)' },
            ],
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
                    steps.lengths.fill(1);
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

        /** The sound browser (instruments, the track's edited sound, favorites) as a `< >` parameter. */
        const soundParam: Param = {
            name: 'Sound',
            help: 'browse the sounds of the current track: the instruments, its edited sound, then the favorites (★)',
            value: () => (c.cur.kind ? c.soundName(c.track) : 'empty track'),
            step: (d) => c.browse(c.track, d, false),
        };
        const search: Page = {
            button: 'search',
            name: 'Sound',
            params: [soundParam],
            tap: { name: 'Next sound for the current track', run: () => c.browse(c.track, 1, true) },
        };

        const plugin: Page = {
            button: 'plug_in',
            get name() {
                if (!c?.cur.kind) return 'Sound';
                return c.cur.kind === 'drums' ? DRUM_SOUNDS[c.drumSound].name : findInstrument(soundsFor(c.cur.kind), c.cur.sound).name;
            },
            get hint() {
                return c?.cur.kind ? undefined : EMPTY;
            },
            // Sound, then the instrument's parameters (drums: those of the selected drum sound)
            get params(): Param[] {
                if (!c?.cur.kind) return [];
                return [
                    soundParam,
                    ...c.shownParams().map((def) => ({
                        name: def.name,
                        value: () => formatParam(def, c.paramValue(def)),
                        step: (d: number) => c.setParam(c.track, def, stepParam(def, c.paramValue(def), d)),
                    })),
                ];
            },
            // drums: pads 1–8 pick the drum sound (and play it); notes / chords: the pads stay playable
            get cells() {
                if (c?.cur.kind !== 'drums') return undefined;
                return () => Array.from({ length: 16 }, (_, i): Cell => (i < DRUMS ? { color: DRUM_SOUNDS[i].color, level: i === c.drumSound ? 3 : 1 } : OFF));
            },
            get padDown() {
                if (c?.cur.kind !== 'drums') return undefined;
                return (pad: number, velocity: number) => {
                    if (pad >= DRUMS) return;
                    c.drumSound = pad;
                    c.sounds.drum(c.track, pad, c.sounds.ctx.currentTime, velocity);
                    c.pages.refresh();
                };
            },
            apply: { name: 'Randomize the sound (drums: the selected drum sound); stored, a short press goes back', run: () => c.randomize(c.track) },
            tap: { name: 'Back to the sound before the last randomize; again = forward (A/B)', run: () => c.revert(c.track) },
            help: [
                {
                    keys: 'PLUG-IN + < > + encoder',
                    text: 'Sound (the browser), then the instrument’s parameters (wave, cutoff, envelope, …, Drive = distortion). Changes play right away and are saved with the track',
                },
                { keys: 'PLUG-IN + pad 1–8', text: 'Drums: pick the drum sound to edit (Tune, Decay, Tone, Level, Drive per drum sound)' },
            ],
        };

        // via the prototype: `c` is null when building the cheat sheet (shiftFunctions only uses `this` in callbacks)
        const fns = MuOpController.prototype.shiftFunctions.call(c);
        const shift: Page = {
            button: 'shift',
            name: 'Shift',
            hint: 'pad = function',
            modifier: true,
            buttons: ['tap'],
            close: () => c.stripValue(null),
            strip: (position) => c.liveDensity(position),
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
                {
                    keys: 'SHIFT + strip',
                    text: 'Density of the selected track, live (orange bar): re-generates its pattern with déjà vu locked, so the same groove gets thinner ↔ busier. For breaks. A hand-made pattern gets replaced on the first move; undo with SHIFT + pad 1',
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

        /** A generator setting 0..1 of the selected track, in 5 % steps; `when` = for which kinds it matters. */
        const gen = (name: string, help: string, key: Exclude<keyof GenSettings, 'auto'>, when: TrackKind[]) => ({
            name,
            help,
            value: () => (c.cur.kind && when.includes(c.cur.kind) ? `${pct(c.generator(c.track).settings[key])}%` : '–'),
            step: (d: number) => {
                const g = c.generator(c.track).settings;
                g[key] = clamp(Math.round((g[key] + d * 0.05) * 20) / 20, 0, 1);
            },
        });
        const variation: Page = {
            button: 'variation',
            name: 'Variation',
            params: [
                gen('Density', 'density (how many hits / notes)', 'density', ['drums', 'notes', 'chords']),
                gen('Deja vu', 'déjà vu: 0 = all new, ½ = the same again (turn the others to reshape it), 1 = shuffled (also the touch strip)', 'dejaVu', [
                    'drums',
                    'notes',
                    'chords',
                ]),
                gen('Bias', 'bias (drums: straight ↔ busy offbeats; notes: low ↔ high)', 'bias', ['drums', 'notes']),
                gen('Spread', 'spread (notes: range; chords: share of 7th chords)', 'spread', ['notes', 'chords']),
                gen('Steps', 'steps (notes: any note ↔ only the root; chords: any move ↔ only the strongest)', 'steps', ['notes', 'chords']),
                {
                    name: 'Auto',
                    help: 'auto: a new variation every 1 / 2 / 4 bars while playing (VARIATION lit)',
                    value: () => {
                        const n = c.generator(c.track).settings.auto;
                        return n ? `every ${n} bar${n > 1 ? 's' : ''}` : 'off';
                    },
                    step: (d) => {
                        const g = c.generator(c.track).settings;
                        g.auto = AUTO_BARS[clamp(AUTO_BARS.indexOf(g.auto as (typeof AUTO_BARS)[number]) + Math.sign(d), 0, AUTO_BARS.length - 1)];
                    },
                },
            ],
            open: () => c.stripValue(c.generator(c.track).settings.dejaVu, 'violet'),
            close: () => c.stripValue(null),
            strip: (position) => {
                if (!position) return;
                const g = c.generator(c.track).settings;
                g.dejaVu = Math.round(((position - 1) / (STRIP_MAX - 1)) * 20) / 20;
                c.stripValue(g.dejaVu, 'violet');
                c.say(`Variation\nDeja vu: ${pct(g.dejaVu)}%`);
            },
            apply: { name: 'Generate a variation into the current pattern (drums in STEP mode: only the selected sound)', run: () => c.generate(c.track) },
            tap: { name: 'Generate a variation (same as push)', run: () => c.generate(c.track) },
            help: [
                {
                    keys: 'VARIATION',
                    text: 'Random patterns, Marbles style. Empty track or any track: makes a pattern from scratch. Déjà vu sets the depth: low = a lot changes, ½ = the same pattern (reshape it with density / bias / spread / steps), high = shuffled. Undo with SHIFT + pad 1',
                },
                { keys: 'VARIATION + strip', text: 'Déjà vu (the strip shows it in violet while VARIATION is held)' },
            ],
        };

        /** The chords track the CHORDS page edits: the selected one, else the harmony track. */
        const chordsTrack = () => (c.cur.kind === 'chords' ? c.track : harmonyTrack(c.song));
        const chords: Page = {
            button: 'chords',
            name: 'Key',
            // pressing CHORDS selects the chords track (as a shortcut), holding it shows the key page
            open: () => c.selectKind('chords', false),
            params: [
                {
                    name: 'Root',
                    help: 'song root C…B (also SHIFT + pad 13 / 14)',
                    value: () => NOTE_NAMES[c.song.root],
                    step: (d) => c.setKey({ root: c.song.root + d }),
                },
                {
                    name: 'Scale',
                    help: 'scale (minor, major, modes, pentatonic)',
                    value: () => findScale(c.song.scale).name,
                    step: (d) => c.setKey({ scale: SCALES[clamp(SCALES.findIndex((x) => x.id === c.song.scale) + d, 0, SCALES.length - 1)].id }),
                },
                {
                    name: 'Voicing',
                    help: 'voicing of the chords track (close, 1st / 2nd inversion, open, sus2, sus4)',
                    value: () => (chordsTrack() < 0 ? '–' : VOICINGS[c.song.tracks[chordsTrack()].voicing]),
                    step: (d) => {
                        const t = chordsTrack();
                        if (t >= 0) c.setTrack(t, { voicing: c.song.tracks[t].voicing + d });
                    },
                },
            ],
            cells: () =>
                Array.from({ length: 16 }, (_, i): Cell => {
                    if (i < 12) return i === c.song.root ? { color: 'white', level: 3 } : { color: NOTE_NAMES[i].includes('#') ? 'violet' : 'blue', level: 1 };
                    return QUICK_SCALES[i - 12] === c.song.scale ? { color: 'white', level: 3 } : { color: 'orange', level: 1 };
                }),
            padDown: (pad) => {
                if (pad < 12) c.setKey({ root: pad });
                else c.setKey({ scale: QUICK_SCALES[pad - 12] });
                c.say(`Key\n${keyName(c.song)}`);
                // let the key be heard: the tonic chord on the chords track
                const t = chordsTrack();
                if (t < 0) return;
                const now = c.sounds.ctx.currentTime;
                for (const midi of trackMidis(c.song.tracks[t], 0, null, c.song)) c.sounds.note(t, midi, now, 0.8, 0.5);
            },
            help: [
                { keys: 'CHORDS', text: 'Press: select the chords track. Hold: the key page' },
                {
                    keys: 'CHORDS + pad',
                    text: 'Pads 1–12 = song root C … B (current = white), 13–16 = scale minor / major / dorian / mixolydian. Plays the tonic chord. Steps keep their scale degrees, so the whole song moves to the new key',
                },
            ],
        };

        return [select, pattern, duplicate, erase, perform, tempo, swing, volume, search, plugin, chords, variation, shift];
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
                this.padUp(e.pad, e.duration);
                break;
            case 'encoder':
                this.encoder(e.delta);
                break;
            case 'buttonUp':
                // STEP held (long or used): it was a temporary switch, back to the other view
                if (e.button === 'step' && (e.chorded || e.duration >= TAP_MS)) {
                    this.stepMode = !this.stepMode;
                    this.say(this.stepMode ? `Steps\n${this.label(this.track)}` : 'Play pads');
                }
                break; // update() either way: the page shows the held button
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
        if (button === 'star') return this.saveFavorite();
        if ((button === 'arrow_left' || button === 'arrow_right') && this.heldStep && kind && kind !== 'drums') {
            this.stepParam = button === 'arrow_right' ? 1 : 0;
            return this.showStep();
        }
        if (button === 'tap' && shift) {
            return this.say(this.metronome.toggle() ? 'Metronome on' : 'Metronome off');
        }
        switch (button) {
            // shortcuts to the first track of a kind; KEYBOARD steps through the notes tracks (bass ↔ lead)
            case 'pad_mode':
                return this.selectKind('drums');
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
                this.beats = -1;
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

    private selectKind(kind: TrackKind, announce = true): void {
        const i = this.song.tracks.findIndex((t) => t.kind === kind);
        if (i >= 0) this.selectTrack(i, announce);
    }

    /** Pads when no page took them: play, or steps in STEP mode. */
    private padDown(pad: number, velocity: number, time: number): void {
        const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
        const kind = this.cur.kind;
        if (!kind) return;

        const now = this.sounds.ctx.currentTime;
        if (this.stepMode) {
            if (pad >= this.cur.length) return this.say(`Step ${pad + 1}\nlength ${this.cur.length}`);
            const held = this.heldStep;
            if (held && kind !== 'drums') {
                // hold a step + tap a later one: the note lasts up to there
                if (pad > held.pad) this.setStepLength(held.pad, pad - held.pad + 1);
                return;
            }
            if (kind === 'drums') {
                this.history.edit(this.seq.pattern);
                const row = steps.drums[this.drumSound];
                row[pad] = row[pad] > 0 ? 0 : 0.8;
                if (row[pad]) this.sounds.drum(this.track, this.drumSound, now, 0.8);
            } else if (steps.notes[pad] === null) {
                this.history.edit(this.seq.pattern);
                steps.notes[pad] = this.pens[this.track];
                steps.lengths[pad] = 1;
                this.preview(this.pens[this.track]);
                this.heldStep = { pad, created: true, edited: false };
                this.showStep();
            } else {
                this.heldStep = { pad, created: false, edited: false };
                this.showStep();
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
            const at = this.recording ? this.seq.record(target, time, pad) : null;
            if (at) {
                this.recPads.set(pad, { track: this.track, at });
                this.saveSoon();
            }
            this.say(this.valueName(pad));
        }
        this.flash(pad, this.padColor(pad), 0);
    }

    /** PERFORM + pad: FX on while held (pads 1–8 on the selected track, 9–16 global). ERASE held: clear it instead. */
    private fxDown(pad: number): void {
        const def = FX[pad];
        const hit: FxHit = isTrackFx(pad) ? { fx: pad, track: this.track } : { fx: pad };
        if (hit.track !== undefined && !this.cur.kind) return this.say(`${this.label(this.track)}\n${EMPTY}`);
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

    private padUp(pad: number, duration: number): void {
        if (this.fxPads.has(pad)) this.fxUp(pad);
        for (const v of this.liveVoices.get(pad) ?? []) v.release();
        this.liveVoices.delete(pad);
        if (!this.flashTimers.has(pad)) this.flashLayer.pad(pad, 'off');

        const rec = this.recPads.get(pad);
        if (rec) {
            this.recPads.delete(pad);
            this.seq.recordLength(rec.track, rec.at, duration);
            this.saveSoon();
        }

        const held = this.heldStep;
        if (held?.pad === pad) {
            // a short tap on a set step clears it; holding it (to look at / edit it) doesn't
            if (!held.created && !held.edited && duration < TAP_MS) {
                this.history.edit(this.seq.pattern);
                const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
                steps.notes[pad] = null;
                steps.lengths[pad] = 1;
                this.saveSoon();
                this.say(`Step ${pad + 1}\ncleared`);
            }
            this.heldStep = null;
        }
    }

    /** Encoder when no page took it: edits the held step (STEP mode, notes / chords). */
    private encoder(delta: number): void {
        const t = this.cur;
        if (this.heldStep && t.kind && t.kind !== 'drums' && this.stepParam === 1) {
            const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
            if (steps.notes[this.heldStep.pad] === null) return;
            this.setStepLength(this.heldStep.pad, steps.lengths[this.heldStep.pad] + delta);
            return;
        }
        if (this.heldStep && t.kind && t.kind !== 'drums') {
            const notes = this.song.patterns[this.seq.pattern].tracks[this.track].notes;
            const [lo, hi] = t.kind === 'chords' ? [0, CHORDS - 1] : [MIN_DEGREE, MAX_DEGREE];
            const value = clamp((notes[this.heldStep.pad] ?? this.pens[this.track]) + delta, lo, hi);
            this.history.edit(this.seq.pattern);
            this.song.patterns[this.seq.pattern].tracks[this.track].notes[this.heldStep.pad] = value;
            this.pens[this.track] = value;
            this.heldStep.edited = true;
            this.preview(value);
            this.showStep();
        } else {
            return;
        }
        this.saveSoon();
    }

    /** Length of a notes / chords step, 1..MAX_LENGTH (and the track's length). */
    private setStepLength(pad: number, length: number): void {
        const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
        if (steps.notes[pad] === null) return;
        this.history.edit(this.seq.pattern);
        steps.lengths[pad] = clamp(length, 1, Math.min(MAX_LENGTH, this.cur.length));
        if (this.heldStep?.pad === pad) this.heldStep.edited = true;
        this.stepParam = 1;
        this.showStep();
        this.saveSoon();
    }

    /** Display for the held step: its menu (Note / Length with `< >`). */
    private showStep(): void {
        const held = this.heldStep;
        if (!held) return;
        const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
        const n = steps.notes[held.pad];
        if (n === null) return this.say(`Step ${held.pad + 1}\nempty`);
        const len = steps.lengths[held.pad];
        const value = this.stepParam === 0 ? `Note: ${this.valueName(n)}` : `Length: ${len} step${len > 1 ? 's' : ''}`;
        this.say(`Step ${held.pad + 1}  ${this.stepParam + 1}/2\n${value}`);
    }

    // --- VARIATION ---

    private generator(track: number): Generator {
        let g = this.generators.get(track);
        if (!g) this.generators.set(track, (g = new Generator()));
        return g;
    }

    /** Writes a variation into `pattern` (drums in STEP mode: the selected sound only). */
    private generate(track: number, pattern = this.seq.pattern, announce = true): void {
        const t = this.song.tracks[track];
        if (!t.kind) return;
        const g = this.generator(track);
        const one = t.kind === 'drums' && this.stepMode && track === this.track ? this.drumSound : undefined;
        this.history.edit(pattern);
        g.generate(t, this.song.patterns[pattern].tracks[track], this.song, one);
        this.saveSoon();
        if (announce) this.say(`Variation ${pct(g.settings.dejaVu)}%\n${one !== undefined ? DRUM_SOUNDS[one].name : this.label(track)}`);
        this.update();
    }

    /** SHIFT + strip: the selected track's density, re-generated live with déjà vu locked (same pattern identity). */
    private liveDensity(position: number): void {
        if (!position) return this.stripValue(null);
        if (!this.cur.kind) return this.say(`${this.label(this.track)}\n${EMPTY}`);
        const g = this.generator(this.track).settings;
        const density = Math.round(((position - 1) / (STRIP_MAX - 1)) * 20) / 20;
        this.stripValue(density, 'orange');
        if (density === g.density) return;
        g.density = density;
        const dejaVu = g.dejaVu;
        g.dejaVu = 0.5;
        try {
            this.generate(this.track, this.seq.pattern, false);
        } finally {
            g.dejaVu = dejaVu;
        }
        this.say(`Density ${pct(density)}%\n${this.label(this.track)}`);
    }

    /**
     * While playing, the blanked display shows the position as in the app's status bar: "P3  2.4 /3" = pattern 3,
     * bar 2 beat 4 of a 3-bar cycle (starts over when all tracks line up again; "/n" only for cycles > 1 bar).
     * Small text, one frame per beat, moving a bit every bar (bouncing around) so the OLED wears evenly.
     */
    private idlePosition(pattern: number, tick: number): void {
        const n = ++this.beats;
        const moves = Math.floor(n / 4);
        const tri = (v: number, m: number) => m - Math.abs((v % (2 * m)) - m);
        const cycle = this.cycle();
        const inCycle = tick % cycle;
        const bars = cycle / STEPS;
        const text = `P${pattern + 1}  ${Math.floor(inCycle / STEPS) + 1}.${Math.floor((inCycle % STEPS) / 4) + 1}${bars > 1 ? ` /${bars}` : ''}`;
        this.m.screen.idle(text, tri(moves * 5, 128 - 6 * text.length), 9 + tri(moves * 2, 23));
    }

    /** Strip LEDs as a bar 0..1 (null = off). */
    private stripValue(v: number | null, color: Color = 'cyan'): void {
        const lit = v === null ? -1 : Math.round(v * (STRIP_LEDS - 1));
        for (let i = 0; i < STRIP_LEDS; i++) this.m.lights.strip(i, i <= lit ? color : 'off', i === lit ? 3 : 1);
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
            { name: 'Semitone -', color: 'violet', run: () => this.semitone(-1), available: always },
            { name: 'Semitone +', color: 'violet', run: () => this.semitone(1), available: always },
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
        const len = this.cur.length;
        // rotates the first `length` steps (the ones the track plays)
        const rotate = <T>(a: T[]) => {
            const part = a.slice(0, len);
            if (dir > 0) part.unshift(part.pop()!);
            else part.push(part.shift()!);
            a.splice(0, len, ...part);
        };
        this.history.edit(this.seq.pattern);
        const one = this.cur.kind === 'drums' && this.stepMode;
        if (this.cur.kind === 'drums') {
            if (one) rotate(steps.drums[this.drumSound]);
            else steps.drums.forEach(rotate);
        } else {
            rotate(steps.notes);
            rotate(steps.lengths);
        }
        this.saveSoon();
        this.say(`Nudge ${dir > 0 ? '>' : '<'}\n${one ? DRUM_SOUNDS[this.drumSound].name : this.label(this.track)}`);
    }

    private clearTrack(): void {
        const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
        this.history.edit(this.seq.pattern);
        steps.notes.fill(null);
        steps.lengths.fill(1);
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
        this.clipboard = { kind: this.cur.kind!, steps: clonePatternTrack(steps) };
        this.say(`Copy\n${this.label(this.track)} P${this.seq.pattern + 1}`);
    }

    private pasteTrack(): void {
        const clip = this.clipboard!;
        this.history.edit(this.seq.pattern);
        this.song.patterns[this.seq.pattern].tracks[this.track] = clonePatternTrack(clip.steps);
        this.saveSoon();
        this.say(`Paste\n${this.label(this.track)} P${this.seq.pattern + 1}`);
    }

    /** Song root one semitone down / up. */
    private semitone(dir: 1 | -1): void {
        this.setKey({ root: this.song.root + dir });
        this.say(`Key\n${keyName(this.song)}`);
    }

    private octave(dir: 1 | -1): void {
        const t = this.cur;
        this.setTrack(this.track, { octave: t.octave + dir });
        this.say(`${this.label(this.track)}\noctave ${t.octave > 0 ? '+' : ''}${t.octave}`);
    }

    // --- notes / chords helpers ---

    /**
     * The chord the notes tracks follow right now: while playing the harmony track's chord on the current step,
     * stopped the last chord played on it (its pen).
     */
    private currentChord(): number | null {
        if (this.seq.playing) return this.seq.chord;
        const h = harmonyTrack(this.song);
        return h < 0 ? null : this.pens[h];
    }

    /** Midi notes of a value on the current track: a scale degree / chord tone (notes) or a chord number (chords). */
    private midis(value: number): number[] {
        return trackMidis(this.cur, value, this.currentChord(), this.song);
    }

    private valueName(value: number): string {
        const t = this.cur;
        if (t.kind === 'chords') return chordName(value, this.song, t.voicing);
        const midi = this.midis(value)[0];
        return midi === undefined ? '–' : midiName(midi);
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
            // steps a longer note is held over (dim, in its color)
            const tails: (Color | null)[] = Array(16).fill(null);
            if (kind !== 'drums') {
                steps.notes.forEach((n, s) => {
                    if (n === null || s >= this.cur.length) return;
                    const color = kind === 'chords' ? noteColor(chordRoot(n)) : noteColor(n);
                    // up to the next note (it cuts this one)
                    for (let j = s + 1; j < Math.min(this.cur.length, s + steps.lengths[s]) && steps.notes[j] === null; j++) tails[j] = color;
                });
            }
            return all((s): Cell => {
                if (s >= this.cur.length) return OFF; // beyond the track's length
                if (kind === 'drums') {
                    const v = steps.drums[this.drumSound][s];
                    if (v > 0) return { color: DRUM_SOUNDS[this.drumSound].color, level: v > 0.66 ? 3 : v > 0.33 ? 2 : 1 };
                } else {
                    const n = steps.notes[s];
                    if (n !== null) return { color: kind === 'chords' ? noteColor(chordRoot(n)) : noteColor(n), level: 3 };
                    if (tails[s]) return { color: tails[s]!, level: 1 };
                }
                return s % 4 === 0 ? { color: 'white', level: 1 } : OFF;
            });
        }
        if (kind === 'drums') return all((i) => (i < DRUMS ? { color: DRUM_SOUNDS[i].color, level: i === this.drumSound ? 2 : 1 } : OFF));
        if (kind === 'chords') {
            // the last chord played = white, likely next chords brighter
            const pen = this.pens[this.track];
            const w = nextChordWeights(pen, this.song);
            return all((i) => (i === pen ? { color: 'white', level: 2 } : { color: noteColor(chordRoot(i)), level: w[i] >= 0.85 ? 3 : w[i] >= 0.6 ? 2 : 1 }));
        }
        // the root pads orange: every scale octave, or every 3rd pad (root, 3rd, 5th) when following the chords
        const n = this.cur.harmony === 'follow' ? 3 : scaleLength(this.song);
        return all((i) => ({ color: i % n === 0 ? 'orange' : 'blue', level: 1 }));
    }

    /** Redraws the lights and notifies the page. */
    private update(): void {
        const l = this.m.lights;
        const cells = this.cells();
        cells.forEach((c, i) => this.grid.pad(i, c.color, c.level));

        this.playhead.clear();
        const head = this.positions[this.track] ?? -1;
        const showHead = this.stepMode && this.seq.playing && head >= 0 && !this.pages.active?.cells;
        if (showHead) this.playhead.pad(head, 'white', 3);
        // the display stays on while a page button or a step is held, blanks 3 s after release
        this.m.screen.hold(!!this.pages.active || !!this.heldStep);
        if (!this.seq.playing && this.beats >= 0) {
            this.beats = -1;
            this.m.screen.idle(null);
        }
        if (!this.recording && !this.m.input.heldButtons.length && !this.m.input.heldPads.length) this.history.close();

        // 1 = usable, more = a state; page buttons and the held page's view are applied by `pages.lights()`
        const input = this.m.input;
        const kind = this.cur.kind;
        const beat = this.seq.playing && this.step % 4 === 0;
        const levels = new Map<LedButton, number>([
            ['pad_mode', kind === 'drums' ? 4 : 1],
            ['keyboard', kind === 'notes' ? 4 : 1],
            ['chords', kind === 'chords' ? 4 : 1],
            ['step', this.stepMode || input.isHeld('step') ? 4 : 1],
            ['play', this.seq.playing ? (beat ? 4 : 2) : 1],
            ['rec', this.recording ? 4 : 1],
            ['stop', 1],
            ['restart', 1],
            ['tap', this.metronome.enabled ? (beat ? 4 : 2) : 1],
            ['star', input.isHeld('star') ? 4 : kind && favoriteOf(kind, this.cur.sound, this.cur.params) >= 0 ? 3 : 1],
            ['perform', this.activeFx().length ? 3 : 1],
            ['variation', this.generators.get(this.track)?.settings.auto ? 3 : 1],
        ]);
        if (this.heldStep && kind && kind !== 'drums') {
            levels.set('arrow_left', input.isHeld('arrow_left') ? 4 : 1);
            levels.set('arrow_right', input.isHeld('arrow_right') ? 4 : 1);
        }
        const lit = this.pages.lights(levels, (b) => input.isHeld(b));
        for (const b of LED_BUTTONS) l.button(b, lit.get(b) ?? 0);
        l.flush();

        if (showHead) cells[head] = { color: 'white', level: 3 };
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
        this.stripValue(position ? (position - 1) / (STRIP_MAX - 1) : null);
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

    /** Clock steps after which every track in use is back at its step 1 on a bar line (LCM of the loop lengths). */
    private cycle(): number {
        const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
        // in half clock steps (×2 clock tracks loop on half steps), the bar (16 clock steps) included
        let units = 2 * STEPS;
        for (const t of this.song.tracks) {
            if (!t.kind) continue;
            const u = Math.round((2 * t.length) / t.rate);
            units = (units / gcd(units, u)) * u;
        }
        return units / 2;
    }

    /** The drum sound PLUG-IN / STEP / the sound editor work on (sound editor). */
    selectDrumSound(sound: number): void {
        this.drumSound = clamp(sound, 0, DRUMS - 1);
        this.update();
    }

    /** Master level for the page's meter (per animation frame). */
    meter() {
        return this.sounds.meter();
    }

    /** The summed audio inputs' level (mixer meter). */
    inputsMeter() {
        return this.sounds.inputsMeter();
    }

    /** A track's level for the mixer meters (per animation frame). */
    trackMeter(track: number) {
        return this.sounds.trackMeter(track);
    }

    /** Master volume 0..1 (mixer, VOLUME page). */
    setVolume(v: number): void {
        this.song.volume = clamp(v, 0, 1);
        this.sounds.volume = this.song.volume;
        this.saveSoon();
        this.update();
    }

    /** Pad labels for the app page: the play view's sounds / notes / chords, or the steps' values in STEP mode. */
    private padLabels(): string[] {
        const kind = this.cur.kind;
        const none = Array<string>(16).fill('');
        if (!kind || this.pages.active?.cells) return none;
        const steps = this.song.patterns[this.seq.pattern].tracks[this.track];
        if (this.stepMode) {
            return none.map((_, s) => {
                if (s >= this.cur.length) return '';
                if (kind === 'drums') return steps.drums[this.drumSound][s] > 0 ? DRUM_SOUNDS[this.drumSound].name : '';
                const n = steps.notes[s];
                if (n === null) return '';
                const len = steps.lengths[s];
                return len > 1 ? `${this.valueName(n)} ×${len}` : this.valueName(n);
            });
        }
        if (kind === 'drums') return none.map((_, i) => DRUM_SOUNDS[i]?.name ?? '');
        return none.map((_, i) => this.valueName(i));
    }

    private makeView(cells: Cell[] = this.cells()): MuOpView {
        return {
            labels: this.padLabels(),
            track: this.track,
            tracks: this.song.tracks.map((t, i) => ({
                name: t.name,
                kind: t.kind,
                sound: t.sound,
                level: t.level,
                octave: t.octave,
                rate: t.rate,
                length: t.length,
                midi: t.midi,
                harmony: t.harmony,
                voicing: t.voicing,
                mute: t.mute,
                solo: t.solo,
                audible: audible(this.song, i),
                favorite: t.kind ? favorites()[favoriteOf(t.kind, t.sound, t.params)]?.name ?? null : null,
                params: t.params,
            })),
            stepMode: this.stepMode,
            drumSound: this.drumSound,
            pen: this.pens[this.track],
            penName: this.cur.kind && this.cur.kind !== 'drums' ? this.valueName(this.pens[this.track]) : '',
            root: this.song.root,
            scale: this.song.scale,
            keyName: keyName(this.song),
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
            tick: this.seq.playing ? this.tick : -1,
            cycle: this.cycle(),
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
