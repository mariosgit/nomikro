import { BUTTON_BRIGHTNESS, COLORS, LED_BUTTONS, PAD_COUNT, PAD_ORDER, STRIP_LEDS, type Color, type LedButton } from './hardware';

type SendReport = (reportId: number, data: Uint8Array<ArrayBuffer>) => Promise<void>;

// Lights report 0x80: 80 data bytes, one byte per LED.
const REPORT_ID = 0x80;
const REPORT_SIZE = 80; // per HID descriptor (39 + 16 + 25 LEDs)
const BUTTON_OFFSET = 0;  // 39 buttons
const PAD_OFFSET = 39;    // 16 pads
const STRIP_OFFSET = 55;  // 25 strip LEDs

// Lookup tables, built once
const PAD_SLOT = Array.from({ length: PAD_COUNT }, (_, n) => (PAD_ORDER as readonly number[]).indexOf(n));
const BUTTON_SLOT = new Map(LED_BUTTONS.map((b, i) => [b, i]));
const COLOR_NB = new Map(COLORS.map((c, i) => [c, i]));

const toLevel = (level: number, max: number) => Math.round(Math.min(max, Math.max(0, level)));

function checkIndex(kind: string, i: number, count: number): number {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new RangeError(`${kind} ${i} out of range 0..${count - 1}`);
    return i;
}

function colorByte(color: Color, level: number): number {
    const nb = COLOR_NB.get(color);
    if (nb === undefined) throw new RangeError(`Unknown color "${color}"`);
    const l = toLevel(level, 3);
    return nb === 0 || l === 0 ? 0 : 4 * nb + l;
}

/**
 * LED state = the report buffer itself. Setters write the byte directly; flush() sends it.
 * Levels are clamped: pads/strip 0..3, buttons 0..4 (0 = off).
 */
export class Lights {
    private data = new Uint8Array(REPORT_SIZE);
    private dirty = true; // first flush always sends, the device may still show LEDs from before
    private inFlight: Promise<void> | null = null;

    constructor(private send: SendReport) {}

    pad(n: number, color: Color, level = 3): void {
        this.put(PAD_OFFSET + PAD_SLOT[checkIndex('pad', n, PAD_COUNT)], colorByte(color, level));
    }

    strip(i: number, color: Color, level = 3): void {
        this.put(STRIP_OFFSET + checkIndex('strip LED', i, STRIP_LEDS), colorByte(color, level));
    }

    button(name: LedButton, level = 4): void {
        const slot = BUTTON_SLOT.get(name);
        if (slot === undefined) throw new RangeError(`Button "${name}" has no LED`);
        this.put(BUTTON_OFFSET + slot, BUTTON_BRIGHTNESS[toLevel(level, 4)]);
    }

    /** Hardware tests only: raw LED byte without color/level mapping. Button index = position in LED_BUTTONS. */
    raw(kind: 'button' | 'pad' | 'strip', index: number, byte: number): void {
        const at =
            kind === 'pad' ? PAD_OFFSET + PAD_SLOT[checkIndex('pad', index, PAD_COUNT)]
            : kind === 'strip' ? STRIP_OFFSET + checkIndex('strip LED', index, STRIP_LEDS)
            : BUTTON_OFFSET + checkIndex('button', index, LED_BUTTONS.length);
        this.put(at, byte & 0xFF);
    }

    /** All LEDs off (sent on the next flush). */
    clear(): void {
        if (this.data.some((b) => b !== 0)) {
            this.data.fill(0);
            this.dirty = true;
        }
    }

    /**
     * Sends the current state if it changed. At most one report is in flight: calls during a write
     * return the running write, which sends once more afterwards so the latest state always goes out.
     */
    flush(): Promise<void> {
        if (this.inFlight) return this.inFlight;
        if (!this.dirty) return Promise.resolve();
        this.inFlight = this.pump(); // pump awaits before its finally, so this assignment happens first
        return this.inFlight;
    }

    private async pump(): Promise<void> {
        try {
            while (this.dirty) {
                this.dirty = false;
                try {
                    // sendReport copies the bytes synchronously (WebHID spec), so the buffer can be reused right away
                    await this.send(REPORT_ID, this.data);
                } catch (error) {
                    this.dirty = true; // not sent, retry on the next flush
                    throw error;
                }
            }
        } finally {
            this.inFlight = null;
        }
    }

    private put(index: number, byte: number): void {
        if (this.data[index] !== byte) {
            this.data[index] = byte;
            this.dirty = true;
        }
    }
}
