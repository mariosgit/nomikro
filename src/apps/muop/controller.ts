// μOp controller: device input → song edits / playback, song state → pad + button lights + display.
// The page reads `view` (subscribe()); the device is the main instrument.
import { STRIP_LEDS, STRIP_MAX, type Color, type InputEvent, type LedButton, type MaschineMikroMk3 } from '../../maschine';
import { DRUMS, MAX_DEGREE, MIN_DEGREE, clonePattern, degreeName, degreeToMidi, isEmptyPattern, saveSong, type Song } from './model';
import { Sequencer } from './sequencer';
import { devlog } from '../../dev/devlog';
import { Metronome } from '../../engine/metronome';
import { DRUM_SOUNDS, type Synth, type Voice } from './sounds';

export interface Cell {
    color: Color;
    level: number;
}

export interface MuOpView {
    track: 'drums' | 'melody';
    stepMode: boolean;
    drumSound: number;
    /** Melody degree written by step taps (the last note played). */
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
const MODIFIERS: LedButton[] = ['pattern', 'duplicate', 'erase', 'tempo', 'swing', 'volume'];
const NOTE_COLORS: Color[] = ['orange', 'yellow', 'lime', 'green', 'cyan', 'blue', 'violet'];
export const noteColor = (degree: number): Color => NOTE_COLORS[((degree % 7) + 7) % 7];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class MuOpController {
    view: MuOpView;

    private seq: Sequencer;
    private metronome = new Metronome();
    private grid: Layer;
    private playhead: Layer;
    private flashLayer: Layer;
    private track: 'drums' | 'melody' = 'drums';
    private stepMode = false;
    private recording = false;
    private drumSound = 0;
    private pen = 0;
    private step = -1;
    private message = 'μOp';
    /** Pattern taps while PATTERN is held (1 tap = select, more = chain). */
    private tapChain: number[] = [];
    /** Melody step held in step mode: encoder edits its note; a tap without edit on an existing note clears it. */
    private heldStep: { pad: number; created: boolean; edited: boolean } | null = null;
    private liveVoices = new Map<number, Voice>();
    private flashTimers = new Map<number, ReturnType<typeof setTimeout>>();
    private listeners = new Set<() => void>();
    private notifyQueued = false;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    private sayTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private m: MaschineMikroMk3,
        private song: Song,
        private synth: Synth,
    ) {
        this.seq = new Sequencer(song, synth);
        this.grid = m.lights.layer('grid');
        this.playhead = m.lights.layer('playhead');
        this.flashLayer = m.lights.layer('flash');
        synth.volume = song.volume;
        this.view = this.makeView();
    }

    /** Owns the device until the signal aborts. */
    async run(signal: AbortSignal): Promise<void> {
        const offInput = this.m.input.onAny((e) => this.handle(e));
        const offMetronome = this.metronome.attach(this.seq.clock);
        const offStep = this.seq.onStep((s) =>
            this.seq.clock.at(s.time, () => {
                this.step = s.step;
                if (!this.stepMode && !this.modifierView()) {
                    if (this.track === 'drums') for (const d of s.drums) this.flash(d, DRUM_SOUNDS[d].color);
                    else if (s.note !== null && s.note >= 0 && s.note < 16) this.flash(s.note, noteColor(s.note));
                }
                this.update();
            }),
        );
        this.say('μOp\nPAD MODE / KEYBOARD');
        this.update();
        try {
            await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        } finally {
            offInput();
            offStep();
            offMetronome();
            this.seq.stop();
            for (const v of this.liveVoices.values()) v.release();
            for (const t of this.flashTimers.values()) clearTimeout(t);
            clearTimeout(this.sayTimer);
            clearTimeout(this.saveTimer);
            saveSong(this.song);
            this.synth.dispose();
        }
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
                this.synth.setFilter(e.position ? (e.position - 1) / (STRIP_MAX - 1) : null);
                this.drawStrip(e.position);
                break;
            default:
                return;
        }
        this.update();
    }

    private buttonDown(button: string): void {
        const seq = this.seq;
        if (button === 'tap' && this.m.input.isHeld('shift')) {
            return this.say(this.metronome.toggle() ? 'Metronome on' : 'Metronome off');
        }
        switch (button) {
            case 'pad_mode':
                this.track = 'drums';
                return this.say(`Drums\n${DRUM_SOUNDS[this.drumSound].name}`);
            case 'keyboard':
                this.track = 'melody';
                return this.say('Melody');
            case 'step':
                this.stepMode = !this.stepMode;
                return this.say(
                    this.stepMode ? `Steps: ${this.track === 'drums' ? DRUM_SOUNDS[this.drumSound].name : 'melody'}` : 'Play pads',
                );
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

    private padDown(pad: number, velocity: number, time: number): void {
        const input = this.m.input;
        const pattern = this.song.patterns[this.seq.pattern];

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
        if (input.isHeld('erase')) {
            if (this.track === 'melody') {
                pattern.melody.fill(null);
                this.say('Erase melody');
            } else if (pad < DRUMS) {
                pattern.drums[pad].fill(0);
                this.say(`Erase ${DRUM_SOUNDS[pad].name}`);
            }
            return this.saveSoon();
        }

        const now = this.synth.ctx.currentTime;
        if (this.stepMode) {
            if (this.track === 'drums') {
                const row = pattern.drums[this.drumSound];
                row[pad] = row[pad] > 0 ? 0 : 0.8;
                if (row[pad]) this.synth.drum(this.drumSound, now, 0.8);
            } else if (pattern.melody[pad] === null) {
                pattern.melody[pad] = this.pen;
                this.synth.note(degreeToMidi(this.pen), now, 0.8, 0.15);
                this.heldStep = { pad, created: true, edited: false };
            } else {
                this.heldStep = { pad, created: false, edited: false };
            }
            return this.saveSoon();
        }

        // live play
        if (this.track === 'drums') {
            if (pad >= DRUMS) return;
            this.drumSound = pad;
            this.synth.drum(pad, now, velocity);
            this.flash(pad, DRUM_SOUNDS[pad].color, 0);
            if (this.recording && this.seq.record({ track: 'drums', sound: pad }, time, Math.max(0.2, velocity))) this.saveSoon();
        } else {
            this.pen = pad;
            this.liveVoices.get(pad)?.release();
            this.liveVoices.set(pad, this.synth.note(degreeToMidi(pad), now, velocity));
            this.flash(pad, noteColor(pad), 0);
            if (this.recording && this.seq.record({ track: 'melody' }, time, pad)) this.saveSoon();
            this.say(degreeName(pad));
        }
    }

    private padUp(pad: number): void {
        this.liveVoices.get(pad)?.release();
        this.liveVoices.delete(pad);
        if (!this.flashTimers.has(pad)) this.flashLayer.pad(pad, 'off');

        const held = this.heldStep;
        if (held?.pad === pad) {
            if (!held.created && !held.edited) {
                this.song.patterns[this.seq.pattern].melody[pad] = null;
                this.saveSoon();
            }
            this.heldStep = null;
        }
    }

    private encoder(delta: number): void {
        const input = this.m.input;
        const song = this.song;
        if (input.isHeld('tempo')) {
            song.bpm = clamp(song.bpm + delta, 40, 240);
            this.seq.clock.bpm = song.bpm;
            this.say(`${song.bpm} BPM`);
        } else if (input.isHeld('swing')) {
            song.swing = clamp(song.swing + delta, 50, 75);
            this.seq.clock.swing = song.swing;
            this.say(`Swing ${song.swing}%`);
        } else if (input.isHeld('volume')) {
            song.volume = clamp(Math.round((song.volume + delta * 0.02) * 100) / 100, 0, 1);
            this.synth.volume = song.volume;
            this.say(`Volume ${Math.round(song.volume * 100)}`);
        } else if (this.heldStep) {
            const melody = song.patterns[this.seq.pattern].melody;
            const degree = clamp((melody[this.heldStep.pad] ?? this.pen) + delta, MIN_DEGREE, MAX_DEGREE);
            melody[this.heldStep.pad] = degree;
            this.pen = degree;
            this.heldStep.edited = true;
            this.synth.note(degreeToMidi(degree), this.synth.ctx.currentTime, 0.8, 0.12);
            this.say(degreeName(degree));
        } else {
            return;
        }
        this.saveSoon();
    }

    // --- output ---

    /** PATTERN / DUPLICATE held: the pads show the patterns. */
    private modifierView(): boolean {
        return this.m.input.isHeld('pattern') || this.m.input.isHeld('duplicate');
    }

    private cells(): Cell[] {
        const song = this.song;
        const pattern = song.patterns[this.seq.pattern];
        const input = this.m.input;

        if (this.modifierView()) {
            const chain = this.seq.pendingChain ?? song.chain;
            return song.patterns.map((p, i) =>
                i === this.seq.pattern ? { color: 'white', level: 3 }
                : chain.includes(i) ? { color: 'green', level: 2 }
                : !isEmptyPattern(p) ? { color: 'blue', level: 1 }
                : OFF,
            );
        }
        if (input.isHeld('erase') && this.track === 'drums') {
            return Array.from({ length: 16 }, (_, i) =>
                i < DRUMS && pattern.drums[i].some((v) => v > 0) ? { color: DRUM_SOUNDS[i].color, level: 1 } : OFF,
            );
        }
        if (this.stepMode) {
            return Array.from({ length: 16 }, (_, s): Cell => {
                if (this.track === 'drums') {
                    const v = pattern.drums[this.drumSound][s];
                    if (v > 0) return { color: DRUM_SOUNDS[this.drumSound].color, level: v > 0.66 ? 3 : v > 0.33 ? 2 : 1 };
                } else {
                    const d = pattern.melody[s];
                    if (d !== null) return { color: noteColor(d), level: 3 };
                }
                return s % 4 === 0 ? { color: 'white', level: 1 } : OFF;
            });
        }
        if (this.track === 'drums') {
            return Array.from({ length: 16 }, (_, i) =>
                i < DRUMS ? { color: DRUM_SOUNDS[i].color, level: i === this.drumSound ? 2 : 1 } : OFF,
            );
        }
        return Array.from({ length: 16 }, (_, i) => ({ color: i % 7 === 0 ? 'orange' : 'blue', level: 1 }));
    }

    /** Redraws the lights and notifies the page. */
    private update(): void {
        const l = this.m.lights;
        const cells = this.cells();
        cells.forEach((c, i) => this.grid.pad(i, c.color, c.level));

        this.playhead.clear();
        const showHead = this.stepMode && this.seq.playing && this.step >= 0 && !this.modifierView();
        if (showHead) this.playhead.pad(this.step, 'white', 3);

        const input = this.m.input;
        const beat = this.seq.playing && this.step % 4 === 0;
        l.button('pad_mode', this.track === 'drums' ? 4 : 1);
        l.button('keyboard', this.track === 'melody' ? 4 : 1);
        l.button('step', this.stepMode ? 4 : 1);
        l.button('play', this.seq.playing ? (beat ? 4 : 2) : 1);
        l.button('rec', this.recording ? 4 : 1);
        l.button('stop', 1);
        l.button('shift', input.isHeld('shift') ? 4 : 1);
        l.button('tap', this.metronome.enabled ? (beat ? 4 : 2) : 1);
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
            stepMode: this.stepMode,
            drumSound: this.drumSound,
            pen: this.pen,
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
