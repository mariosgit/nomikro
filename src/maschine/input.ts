// Input events: edges instead of snapshots, plus what is held right now.
// Fed by the decoded reports (buttons.ts, pads.ts); no knowledge of WebHID here, so it is testable on its own.
import type { ButtonState } from './buttons';
import type { PadEvent } from './pads';
import type { Button } from './hardware';

/** `time` is performance.now() when the report arrived (same timebase as HIDInputReportEvent.timeStamp). */
export type InputEvent =
    /** velocity 0..1 (from the pressure at the press), pressure 0..4095 */
    | { type: 'padDown'; pad: number; velocity: number; pressure: number; time: number }
    /** Pressure change while held (aftertouch). */
    | { type: 'padPressure'; pad: number; pressure: number; time: number }
    /** duration: ms since padDown */
    | { type: 'padUp'; pad: number; duration: number; time: number }
    | { type: 'buttonDown'; button: Button; time: number }
    /**
     * duration: ms since buttonDown. chorded: something else went down (pad, button, encoder turn, strip touch)
     * while it was held, i.e. it was used as a modifier. A tap = short and not chorded.
     */
    | { type: 'buttonUp'; button: Button; duration: number; chorded: boolean; time: number }
    /** delta: steps (± , 16 per turn), position 0..15 */
    | { type: 'encoder'; delta: number; position: number; time: number }
    /** position 1..200 left → right (STRIP_MAX), 0 = released. position2: second finger, 0 = none */
    | { type: 'strip'; position: number; position2: number; time: number };

export type InputEventType = InputEvent['type'];
export type InputEventOf<T extends InputEventType> = Extract<InputEvent, { type: T }>;

/**
 * Pad press detection from the pressure stream. The device's own press event needs firm pressure
 * (≈400..3300 of 4095 seen); light touches only come as pressure updates. So a pad goes down when its pressure
 * reaches `on` (or the device reports a press) and up when it falls below `off` (or the device reports a release).
 * Velocity = the peak pressure within `window` ms after the threshold crossing, scaled: `on` → 0, `full` and above → 1.
 * (A hit rises over a few ms: the first sample is ≈400, the device's press ≈4 ms later says ≈1000+.)
 * padDown is emitted when the device press arrives or the window ends, with the time of the threshold crossing.
 */
export interface PadSensitivity {
    on: number;
    off: number;
    full: number;
    /** Velocity window in ms (0 = emit at the first sample). */
    window: number;
}

interface PadState {
    down: boolean;
    /** Threshold presses allowed. Cleared by a device release until the pressure is seen below `off`. */
    armed: boolean;
    pressure: number;
    since: number;
    /** Threshold crossed, padDown not emitted yet (collecting the peak for the velocity). */
    pending: { time: number; peak: number; timer: ReturnType<typeof setTimeout> } | null;
}

interface HeldButton {
    since: number;
    chorded: boolean;
}

type Listener = (event: InputEvent) => void;

export class Input {
    sensitivity: PadSensitivity = { on: 300, off: 120, full: 2500, window: 8 };

    private pads: PadState[] = Array.from({ length: 16 }, () => ({ down: false, armed: true, pressure: 0, since: 0, pending: null }));
    private buttons = new Map<Button, HeldButton>();
    private stripPos = 0;
    private stripPos2 = 0;
    private listeners = new Set<Listener>();

    // --- held state ---

    isHeld(button: Button): boolean {
        return this.buttons.has(button);
    }
    isPadHeld(pad: number): boolean {
        return this.pads[pad]?.down ?? false;
    }
    /** Held buttons, in press order. */
    get heldButtons(): Button[] {
        return [...this.buttons.keys()];
    }
    /** Held pads, ascending. */
    get heldPads(): number[] {
        return this.pads.flatMap((p, i) => (p.down ? [i] : []));
    }
    padPressure(pad: number): number {
        return this.pads[pad]?.pressure ?? 0;
    }
    /** Touch strip position 1..200, 0 = not touched. */
    get strip(): number {
        return this.stripPos;
    }

    // --- listeners ---

    /** All events. Returns an unsubscribe function. */
    onAny(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Events of one type. Returns an unsubscribe function. */
    on<T extends InputEventType>(type: T, listener: (event: InputEventOf<T>) => void): () => void {
        return this.onAny((e) => {
            if (e.type === type) listener(e as InputEventOf<T>);
        });
    }

    removeAllListeners(): void {
        this.listeners.clear();
    }

    // --- feeding (called by the device) ---

    handleButtons(state: ButtonState, time: number): void {
        const pressed = new Set(state.btn_pressed as Button[]);
        for (const [button, held] of this.buttons) {
            if (pressed.has(button)) continue;
            this.buttons.delete(button);
            this.emit({ type: 'buttonUp', button, duration: time - held.since, chorded: held.chorded, time });
        }
        for (const button of pressed) {
            if (this.buttons.has(button)) continue;
            // enc-touched is a side effect of turning, not a deliberate press: don't let it chord other buttons
            if (button !== 'enc-touched') this.chord();
            this.buttons.set(button, { since: time, chorded: false });
            this.emit({ type: 'buttonDown', button, time });
        }

        if (state.encoder_move !== 0) {
            this.chord('enc-touched');
            this.emit({ type: 'encoder', delta: state.encoder_move, position: state.encoder_pos, time });
        }

        if (state.strip_pos_1 !== this.stripPos || state.strip_pos_2 !== this.stripPos2) {
            if (this.stripPos === 0 && state.strip_pos_1 !== 0) this.chord();
            this.stripPos = state.strip_pos_1;
            this.stripPos2 = state.strip_pos_2;
            this.emit({ type: 'strip', position: this.stripPos, position2: this.stripPos2, time });
        }
    }

    handlePads(events: readonly PadEvent[], time: number): void {
        const { on, off } = this.sensitivity;
        for (const e of events) {
            const p = this.pads[e.pad_nb];
            if (!p) continue;
            const pressure = e.pad_val;

            if (p.pending) {
                if (!e.released) p.pending.peak = Math.max(p.pending.peak, pressure);
                if (e.pressed) this.flushPending(e.pad_nb);
                else if (e.released || (e.touched && pressure < off)) {
                    this.flushPending(e.pad_nb); // a very short hit: down + up
                    this.padUp(e.pad_nb, pressure, time, e.released);
                }
                continue;
            }

            if (!p.down) {
                if (e.touched && pressure < off) p.armed = true;
                p.pressure = e.released ? 0 : pressure;
                // a firm press (device event) always counts; a threshold crossing only once re-armed
                if (e.pressed) this.padDown(e.pad_nb, pressure, time);
                else if (p.armed && e.touched && pressure >= on) {
                    const window = this.sensitivity.window;
                    if (window <= 0) this.padDown(e.pad_nb, pressure, time);
                    else p.pending = { time, peak: pressure, timer: setTimeout(() => this.flushPending(e.pad_nb), window) };
                }
                continue;
            }

            if (e.released || (e.touched && pressure < off)) {
                this.padUp(e.pad_nb, pressure, time, e.released);
            } else if (pressure !== p.pressure) {
                p.pressure = pressure;
                this.emit({ type: 'padPressure', pad: e.pad_nb, pressure, time });
            }
        }
    }

    // --- internals ---

    private flushPending(pad: number): void {
        const p = this.pads[pad];
        if (!p.pending) return;
        const { time, peak, timer } = p.pending;
        clearTimeout(timer);
        p.pending = null;
        this.padDown(pad, peak, time);
    }

    private padDown(pad: number, pressure: number, time: number): void {
        const { on, full } = this.sensitivity;
        const p = this.pads[pad];
        p.down = true;
        p.armed = false;
        p.since = time;
        p.pressure = pressure;
        this.chord();
        const velocity = Math.min(1, Math.max(0, (pressure - on) / (full - on)));
        this.emit({ type: 'padDown', pad, velocity, pressure, time });
    }

    private padUp(pad: number, pressure: number, time: number, deviceRelease: boolean): void {
        const p = this.pads[pad];
        p.down = false;
        // A device release always says pressure 0, even while the finger still rests on the pad:
        // threshold presses wait until a pressure update below `off` re-arms the pad (no double hits).
        p.armed = !deviceRelease;
        p.pressure = deviceRelease ? 0 : pressure;
        this.emit({ type: 'padUp', pad, duration: time - p.since, time });
    }

    /** Marks every held button (except `except`) as used as a modifier. */
    private chord(except?: Button): void {
        for (const [button, held] of this.buttons) if (button !== except) held.chorded = true;
    }

    private emit(event: InputEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                console.error('input listener failed:', error);
            }
        }
    }
}
