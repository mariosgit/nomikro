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
 * One layer of LED state: an 80-byte buffer in report layout. Setters write the byte directly.
 * Levels are clamped: pads/strip 0..3, buttons 0..4 (0 = off).
 */
export class LightLayer {
    protected data = new Uint8Array(REPORT_SIZE);

    constructor(private onChange: () => void) {}

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

    /** All LEDs of this layer off (sent on the next flush). */
    clear(): void {
        if (this.data.some((b) => b !== 0)) {
            this.data.fill(0);
            this.onChange();
        }
    }

    /** Raw bytes, for composing. */
    get bytes(): Readonly<Uint8Array> {
        return this.data;
    }

    private put(index: number, byte: number): void {
        if (this.data[index] !== byte) {
            this.data[index] = byte;
            this.onChange();
        }
    }
}

interface NamedLayer {
    name: string;
    z: number;
    layer: LightLayer;
}

/**
 * The device's LEDs. `m.lights` itself is the bottom layer (z 0); `layer(name)` adds layers on top,
 * e.g. a sequencer grid and an overlay for held pads / playhead, so one doesn't wipe the other.
 * On flush the layers are composed per LED: the topmost non-zero byte wins ('off' is transparent).
 */
export class Lights extends LightLayer {
    private layers: NamedLayer[] = [];
    private out = new Uint8Array(REPORT_SIZE);
    private sent: Uint8Array | null = null; // null: first flush always sends, the device may still show LEDs from before
    private dirty = true;
    private inFlight: Promise<void> | null = null;

    constructor(private send: SendReport) {
        super(() => (this.dirty = true));
    }

    /**
     * The layer with this name, created on first use. Higher z is on top; default = above all existing layers.
     * Draw on it like on `m.lights`, then `m.lights.flush()` (or `layer.flush()`).
     */
    layer(name: string, z?: number): LightLayer & { flush(): Promise<void> } {
        let entry = this.layers.find((l) => l.name === name);
        if (!entry) {
            const layer = Object.assign(new LightLayer(() => (this.dirty = true)), { flush: () => this.flush() });
            entry = { name, z: z ?? Math.max(0, ...this.layers.map((l) => l.z)) + 1, layer };
            this.layers.push(entry);
            this.layers.sort((a, b) => a.z - b.z);
        } else if (z !== undefined && z !== entry.z) {
            entry.z = z;
            this.layers.sort((a, b) => a.z - b.z);
            this.dirty = true;
        }
        return entry.layer as LightLayer & { flush(): Promise<void> };
    }

    /** Removes a layer (all layers without a name). Sent on the next flush. */
    removeLayer(name?: string): void {
        const before = this.layers.length;
        this.layers = name === undefined ? [] : this.layers.filter((l) => l.name !== name);
        if (this.layers.length !== before) this.dirty = true;
    }

    /** Names of the layers above the base, bottom → top. */
    get layerNames(): string[] {
        return this.layers.map((l) => l.name);
    }

    /**
     * Composes the layers and sends the result if it changed. At most one report is in flight: calls during a write
     * return the running write, which sends once more afterwards so the latest state always goes out.
     */
    flush(): Promise<void> {
        if (this.inFlight) return this.inFlight;
        if (!this.dirty) return Promise.resolve();
        this.inFlight = this.pump(); // pump yields before its finally, so this assignment happens first
        return this.inFlight;
    }

    private compose(): Uint8Array<ArrayBuffer> {
        this.out.set(this.data);
        for (const { layer } of this.layers) {
            const bytes = layer.bytes;
            for (let i = 0; i < REPORT_SIZE; i++) if (bytes[i] !== 0) this.out[i] = bytes[i];
        }
        return this.out;
    }

    private async pump(): Promise<void> {
        // Yield first: flush() must store this promise before the finally below clears it
        // (without a write, e.g. a change hidden under a top layer, the loop wouldn't await at all).
        await undefined;
        try {
            while (this.dirty) {
                this.dirty = false;
                const out = this.compose();
                if (this.sent && out.every((b, i) => b === this.sent![i])) continue; // hidden change, nothing to send
                try {
                    // sendReport copies the bytes synchronously (WebHID spec), so the buffer can be reused right away
                    const write = this.send(REPORT_ID, out);
                    (this.sent ??= new Uint8Array(REPORT_SIZE)).set(out);
                    await write;
                } catch (error) {
                    this.sent = null; // unknown device state: send again on the next flush
                    this.dirty = true;
                    throw error;
                }
            }
        } finally {
            this.inFlight = null;
        }
    }
}
