type SendReport = (reportId: number, data: Uint8Array<ArrayBuffer>) => Promise<void>;

// Display: 128×32, 1 bit/pixel, 4 pages (8-pixel rows) × 128 columns = 512 bytes, bit set = pixel off, LSB = top.
// Report 0xE0 (264 bytes): 8-byte header (x, 0, page, 0, width, 0, pages, 0) + the rectangle's bytes, page by page.
// Verified on the device: any rectangle works (x / page / width / pages), but the report must always be the full
// 264 bytes (pad the rest). Shorter reports get paired up: the device draws the first and swallows the next.
// A report takes ~38 ms on the wire, so only the changed rectangle is sent (≤ 256 bytes → 1 report, else 2).
const REPORT_ID = 0xE0;
const REPORT_SIZE = 264;
const HEADER = 8;
const WIDTH = 128;
const HEIGHT = 32;
const PAGES = HEIGHT / 8;
const FRAME_SIZE = WIDTH * PAGES;
const BLANK = new Uint8Array(FRAME_SIZE).fill(0xFF);

/** Drawing callback: a 128×32 canvas, cleared to black. Anything not black (alpha ≥ 50 %, light) lights the pixel. */
export type Draw = (ctx: OffscreenCanvasRenderingContext2D, width: number, height: number) => void;

interface Rect {
    x: number;
    page: number;
    w: number;
    pages: number;
}

export class Screen {
    /** Blank the display this long after the last set() / draw(); 0 = keep it. */
    blankAfter = 3000;
    /** Frame rate cap: frames closer together are merged (only the newest is sent). */
    maxFps = 20;
    private blanktimer: number | null = null;
    private held = false;
    /** Blanked (no message up): the idle text shows instead, if any. */
    private blanked = true;
    private idleText: { text: string; x: number; y: number; size: number } | null = null;

    private canvas: OffscreenCanvas | null = null;
    private ctx: OffscreenCanvasRenderingContext2D | null = null;

    // Single writer: one frame in flight, only the latest pending frame is kept.
    /** What the display shows, null = unknown (startup, failed write): the next frame is sent whole. */
    private shown: Uint8Array | null = null;
    private pending: Uint8Array | null = null;
    private inFlight: Promise<void> | null = null;
    private lastFrame = -Infinity;

    /** Diagnostics: reports sent, frames sent, frames merged by the rate cap / skipped as unchanged. */
    readonly stats = { reports: 0, frames: 0, merged: 0, unchanged: 0 };

    constructor(private send: SendReport) {}

    set(text: string, size: number = 14): Promise<void> {
        return this.draw((ctx) => this.text(ctx, text, size));
    }

    /**
     * Draws a frame (step grid, playhead, values …) on a 128×32 canvas cleared to black; white = lit.
     * Blanks like set(). Call it as often as you like: frames are capped at `maxFps`, only the newest is sent, and
     * only the changed area goes over the wire (changes within 2 rows of 8 px, or narrow ones ≤ 64 px: one report,
     * ~38 ms, so up to ~25 fps; a change across the whole screen: two reports, ~77 ms, ~13 fps).
     */
    draw(fn: Draw): Promise<void> {
        this.blanked = false;
        const done = this.show(this.render(fn));
        this.armBlank();
        return done;
    }

    /**
     * Small text shown while the display is blanked (e.g. the transport position while playing), at x / y (baseline,
     * pixels). Move it around now and then so the aged OLED wears evenly. null = plain blank.
     */
    idle(text: string | null, x = 0, y = 10, size = 10): void {
        this.idleText = text === null ? null : { text, x, y, size };
        if (this.blanked) this.clear().catch(() => {}); // device gone: nothing to blank
    }

    /**
     * Keep the text up while `on` (e.g. while a button or pad is held): no blanking.
     * Back to `false` starts the blank countdown (`blankAfter`) from then.
     */
    hold(on: boolean): void {
        if (on === this.held) return;
        this.held = on;
        this.armBlank();
    }

    private armBlank(): void {
        if (this.blanktimer) {
            window.clearTimeout(this.blanktimer);
            this.blanktimer = null;
        }
        if (this.blankAfter > 0 && !this.held) {
            this.blanktimer = window.setTimeout(() => {
                this.blanktimer = null;
                this.blanked = true;
                this.clear().catch(() => {}); // device gone: nothing to blank
            }, this.blankAfter);
        }
    }

    /** Blank (or the idle text, see idle()). */
    clear(): Promise<void> {
        this.blanked = true;
        const idle = this.idleText;
        return this.show(idle ? this.render((ctx) => this.text(ctx, idle.text, idle.size, idle.x, idle.y)) : BLANK);
    }

    /** Queues a frame; skipped if it equals the latest frame shown or queued. */
    private show(frame: Uint8Array): Promise<void> {
        const latest = this.pending ?? this.shown;
        if (latest && changedRect(latest, frame) === null) {
            this.stats.unchanged++;
            return this.inFlight ?? Promise.resolve();
        }
        if (this.pending) this.stats.merged++;
        this.pending = frame;
        this.inFlight ??= this.pump(); // pump awaits before its finally, so this assignment happens first
        return this.inFlight;
    }

    private async pump(): Promise<void> {
        try {
            while (this.pending) {
                // rate cap: wait for the frame slot; frames drawn meanwhile replace the pending one
                const wait = this.lastFrame + 1000 / this.maxFps - performance.now();
                if (wait > 0) await new Promise((r) => setTimeout(r, wait));
                const frame = this.pending;
                this.pending = null;
                if (!frame) break;
                const rect = this.shown ? changedRect(this.shown, frame) : { x: 0, page: 0, w: WIDTH, pages: PAGES };
                if (!rect) continue; // changed back to what's shown
                this.lastFrame = performance.now();
                this.shown = null; // unknown while writing (a failed write leaves it unknown → next frame whole)
                for (const part of split(rect)) await this.writeRect(frame, part);
                this.shown = frame;
                this.stats.frames++;
            }
        } finally {
            this.inFlight = null;
        }
    }

    private async writeRect(frame: Uint8Array, r: Rect): Promise<void> {
        const data = new Uint8Array(REPORT_SIZE).fill(0xFF); // always the full size, see the top comment
        data.set([r.x, 0, r.page, 0, r.w, 0, r.pages, 0]);
        for (let p = 0; p < r.pages; p++) {
            const from = (r.page + p) * WIDTH + r.x;
            data.set(frame.subarray(from, from + r.w), HEADER + p * r.w);
        }
        this.stats.reports++;
        await this.send(REPORT_ID, data);
    }

    /** The shared canvas, cleared to black. */
    private canvasCtx(): OffscreenCanvasRenderingContext2D {
        if (!this.ctx) {
            this.canvas = new OffscreenCanvas(WIDTH, HEIGHT);
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
        }
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        return ctx;
    }

    private render(fn: Draw): Uint8Array {
        const ctx = this.canvasCtx();
        ctx.save();
        try {
            fn(ctx, WIDTH, HEIGHT);
        } finally {
            ctx.restore();
        }
        return toFrame(ctx.getImageData(0, 0, WIDTH, HEIGHT).data);
    }

    /** One or two lines at the top / bottom; or with x / y: a single line at that baseline. */
    private text(ctx: OffscreenCanvasRenderingContext2D, text: string, size: number, x?: number, y?: number): void {
        ctx.font = `${size}px monospace`;
        const lines = text.split('\n');
        if (x !== undefined && y !== undefined) {
            ctx.fillText(lines[0] || '', x, y);
            return;
        }
        ctx.fillText(lines[0] || '', 0, 16);
        ctx.fillText(lines[1] || '', 0, 32);
    }
}

/** RGBA pixels → display bytes (page-major, LSB = top pixel of the page, bit set = off). Lit = red channel ≥ 128. */
function toFrame(px: Uint8ClampedArray): Uint8Array {
    const buf = new Uint8Array(FRAME_SIZE);
    for (let page = 0; page < PAGES; page++) {
        for (let x = 0; x < WIDTH; x++) {
            let byte = 0;
            for (let bit = 0; bit < 8; bit++) if (px[((page * 8 + bit) * WIDTH + x) * 4] < 128) byte |= 1 << bit;
            buf[page * WIDTH + x] = byte;
        }
    }
    return buf;
}

/** Bounding box of the changed bytes (columns × pages), null = same frame. */
function changedRect(a: Uint8Array, b: Uint8Array): Rect | null {
    let x0 = WIDTH, x1 = -1, p0 = PAGES, p1 = -1;
    for (let page = 0; page < PAGES; page++) {
        for (let x = 0; x < WIDTH; x++) {
            const i = page * WIDTH + x;
            if (a[i] !== b[i]) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (page < p0) p0 = page;
                p1 = page;
            }
        }
    }
    return x1 < 0 ? null : { x: x0, page: p0, w: x1 - x0 + 1, pages: p1 - p0 + 1 };
}

/** One report carries ≤ 256 bytes: split a bigger rectangle into bands of 2 pages. */
function split(r: Rect): Rect[] {
    if (r.w * r.pages <= REPORT_SIZE - HEADER) return [r];
    const parts: Rect[] = [];
    for (let page = r.page; page < r.page + r.pages; page += 2) parts.push({ ...r, page, pages: Math.min(2, r.page + r.pages - page) });
    return parts;
}
