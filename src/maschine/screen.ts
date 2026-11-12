type SendReport = (reportId: number, data: Uint8Array<ArrayBuffer>) => Promise<void>;

// Display: 128×32, 1 bit/pixel, 4 pages × 128 columns = 512 bytes (bit set = pixel off),
// sent as two 0xE0 reports of 256 bytes each.
const REPORT_ID = 0xE0;
const FRAME_SIZE = 512;
const HALF = FRAME_SIZE / 2;
const HEADER_HI = [0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x02, 0x00];
const HEADER_LO = [0x00, 0x00, 0x02, 0x00, 0x80, 0x00, 0x02, 0x00];
const BLANK = new Uint8Array(FRAME_SIZE).fill(0xFF);

const sameFrame = (a: Uint8Array, b: Uint8Array) => a.every((v, i) => v === b[i]);

export class Screen {
    /** Blank the display this long after the last set(); 0 = keep it. */
    blankAfter = 3000;
    private blanktimer: number | null = null;

    // Single writer: one frame in flight, only the latest pending frame is kept.
    private sent: Uint8Array | null = null;
    private pending: Uint8Array | null = null;
    private inFlight: Promise<void> | null = null;

    constructor(private send: SendReport) {}

    set(text: string, size: number = 14): Promise<void> {
        const done = this.show(this.getBuffer(this.getBitImg(text, size)));

        if (this.blanktimer) {
            window.clearTimeout(this.blanktimer);
            this.blanktimer = null;
        }
        if (this.blankAfter > 0) {
            this.blanktimer = window.setTimeout(() => {
                this.clear();
            }, this.blankAfter);
        }
        return done;
    }

    clear(): Promise<void> {
        return this.show(BLANK);
    }

    /** Queues a frame; skipped if it equals the latest frame already sent or queued. */
    private show(frame: Uint8Array): Promise<void> {
        const latest = this.pending ?? this.sent;
        if (latest && sameFrame(latest, frame)) return this.inFlight ?? Promise.resolve();
        this.pending = frame;
        this.inFlight ??= this.pump(); // pump awaits before its finally, so this assignment happens first
        return this.inFlight;
    }

    private async pump(): Promise<void> {
        try {
            while (this.pending) {
                const frame = this.pending;
                this.pending = null;
                this.sent = null; // unknown display content while writing
                await this.writeFrame(frame);
                this.sent = frame;
            }
        } finally {
            this.inFlight = null;
        }
    }

    private async writeFrame(frame: Uint8Array): Promise<void> {
        const hi = new Uint8Array(HEADER_HI.length + HALF);
        hi.set(HEADER_HI);
        hi.set(frame.subarray(0, HALF), HEADER_HI.length);
        const lo = new Uint8Array(HEADER_LO.length + HALF);
        lo.set(HEADER_LO);
        lo.set(frame.subarray(HALF), HEADER_LO.length);
        await this.send(REPORT_ID, hi);
        await this.send(REPORT_ID, lo);
    }

    private getBitImg(text: string, size: number): ImageData {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 32;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 128, 32);
        ctx.fillStyle = 'white';
        ctx.font = `${size}px monospace`;
        const lines = text.split('\n');
        ctx.fillText(lines[0] || '', 0, 16);
        ctx.fillText(lines[1] || '', 0, 32);
        return ctx.getImageData(0, 0, 128, 32);
    }

    private getBuffer(img: ImageData): Uint8Array {
        const buf = new Uint8Array(FRAME_SIZE);
        for (let i = 0; i < 128; i++) {
            for (let line = 0; line < 4; line++) {
                let byteVal = 0x00;
                for (let bit = 0; bit < 8; bit++) {
                    byteVal <<= 1;
                    const pixIndex = ((8 * line + (7 - bit)) * 128 + i) * 4;
                    const pixVal = img.data[pixIndex]; // assuming grayscale
                    if (pixVal < 128) { // black pixel
                        byteVal += 1;
                    }
                }
                buf[128 * line + i] = byteVal;
            }
        }
        return buf;
    }
}
