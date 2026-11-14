// Probe: does the display take partial rectangles (header x / page / width / pages) in a short 0xE0 report?
// Draws 3 lit rectangles on a blank screen, logs write time + errors per report. pad=1 pads to the full 264 bytes.
import { Priority } from '../../../maschine';
import { untilAborted, type Mode } from './types';

type Rect = { x: number; page: number; w: number; pages: number };
const SETS: Record<string, Rect[]> = {
    // top bar, 16×16 block left of center, 8×8 square bottom right
    a: [{ x: 0, page: 0, w: 128, pages: 1 }, { x: 32, page: 1, w: 16, pages: 2 }, { x: 100, page: 3, w: 8, pages: 1 }],
    // full-width bar on row 3; left half of row 4 (x = 0, w = 64)
    b: [{ x: 0, page: 2, w: 128, pages: 1 }, { x: 0, page: 3, w: 64, pages: 1 }],
    // right half of row 1 (x = 64, w = 64); x = 64 full height w = 8
    c: [{ x: 64, page: 0, w: 64, pages: 1 }, { x: 64, page: 0, w: 8, pages: 4 }],
};

export const screenProbe: Mode = {
    label: 'Test: screen rects',
    help: 'Writes partial screen rectangles in short reports. Params: set=a|b|c (see SETS) or rects=x:page:w:pages,…, pad=1, wait=ms (blank before), gap=ms (between rects), fill=stair.',
    async run(m, signal, ctx) {
        const padded = ctx.params.pad === '1';
        const RECTS = ctx.params.rects // rects=x:page:w:pages,…
            ? ctx.params.rects.split(',').map((r) => { const [x, page, w, pages] = r.split(':').map(Number); return { x, page, w, pages }; })
            : (SETS[ctx.params.set ?? 'a'] ?? SETS.a);
        m.screen.blankAfter = 0;
        try {
            // raw blank (screen.clear() would be skipped: the driver doesn't know about the raw rects)
            for (const page of [0, 2]) {
                const blank = new Uint8Array(264).fill(0xFF);
                blank.set([0, 0, page, 0, 128, 0, 2, 0]);
                await m.sendReport(0xE0, blank, Priority.Screen);
            }
            await new Promise((r) => setTimeout(r, Number(ctx.params.wait ?? 1500))); // shot of the blank
            const gap = Number(ctx.params.gap ?? 0); // ms between the rect reports
            for (const r of RECTS) {
                if (gap && r !== RECTS[0]) await new Promise((res) => setTimeout(res, gap));
                const size = padded ? 264 : 8 + r.w * r.pages;
                const data = new Uint8Array(size).fill(0xFF);
                data.set([r.x, 0, r.page, 0, r.w, 0, r.pages, 0]);
                if (ctx.params.fill === 'stair') {
                    // per page: lit from the rect's left edge for 16 × (page + 1) columns → a staircase shows which page went where
                    for (let p = 0; p < r.pages; p++) data.fill(0x00, 8 + p * r.w, 8 + p * r.w + Math.min(r.w, 16 * (r.page + p + 1)));
                } else data.fill(0x00, 8, 8 + r.w * r.pages); // bit clear = pixel on
                const t0 = performance.now();
                try {
                    await m.sendReport(0xE0, data, Priority.Screen);
                    ctx.log(`rect ${JSON.stringify(r)} ${size} bytes: ${(performance.now() - t0).toFixed(1)} ms`);
                } catch (e) {
                    ctx.log(`rect ${JSON.stringify(r)} ${size} bytes: ERROR ${String(e)}`);
                }
            }
            ctx.log('screen probe done');
            await untilAborted(signal);
        } finally {
            m.screen.blankAfter = 3000;
            await m.screen.set(' ');
            await m.screen.clear();
        }
    },
};

/** Screen animation benchmark: draws as fast as possible, the driver caps / merges; logs fps + lights latency. */
export const screenFps: Mode = {
    label: 'Test: screen fps',
    help: 'Animated screen, drawn every 10 ms (the driver caps it). Params: scene=grid|bar|full|text, fps (cap, default 20). Logs frames/s, reports/frame, lights latency.',
    async run(m, signal, ctx) {
        const scene = ctx.params.scene ?? 'grid';
        const s = m.screen;
        const fpsBefore = s.maxFps;
        s.maxFps = Number(ctx.params.fps ?? 20);
        s.blankAfter = 0;
        const t0 = performance.now();
        const draw = () => {
            const t = (performance.now() - t0) / 1000;
            s.draw((c, w, h) => {
                if (scene === 'bar') c.fillRect(Math.floor((t * 64) % w), 0, 2, h); // 2 px bar sweeping, full height
                else if (scene === 'full') {
                    // full-screen change every frame: moving checkerboard
                    const o = Math.floor(t * 20) % 8;
                    for (let y = 0; y < h; y += 4) for (let x = (y / 4) % 2 ? 4 : 0; x < w; x += 8) c.fillRect((x + o) % w, y, 4, 4);
                } else if (scene === 'text') {
                    c.font = '14px monospace';
                    c.fillText(`t ${t.toFixed(2)}`, 0, 14);
                } else {
                    // grid: title row (static) + 16 steps in rows 3–4 with a playhead at 120 BPM 16ths
                    c.font = '10px monospace';
                    c.fillText('Steps · T1 Drums', 0, 9);
                    const step = Math.floor(t * 8) % 16;
                    for (let i = 0; i < 16; i++) {
                        const x = i * 8;
                        if (i % 4 === 0 || i === 6 || i === 10) c.fillRect(x + 1, 17, 6, 6);
                        else c.strokeRect(x + 1.5, 17.5, 5, 5);
                        if (i === step) c.fillRect(x, 26, 8, 3);
                    }
                }
            }).catch(() => {}); // device gone: the task ends via the signal
        };
        const timer = window.setInterval(draw, 10);
        // lights while the screen streams: a pad blinks every 100 ms, flush latency measured
        const latency: number[] = [];
        let on = false;
        const lights = window.setInterval(async () => {
            on = !on;
            m.lights.clear();
            if (on) m.lights.pad(0, 'green');
            const t = performance.now();
            try {
                await m.lights.flush();
            } catch {
                return; // device gone
            }
            latency.push(performance.now() - t);
        }, 100);
        let last = { ...s.stats, t: performance.now() };
        const report = window.setInterval(() => {
            const now = { ...s.stats, t: performance.now() };
            const sec = (now.t - last.t) / 1000;
            const frames = now.frames - last.frames;
            const lat = latency.splice(0);
            ctx.log(
                `${scene} cap ${s.maxFps}: ${(frames / sec).toFixed(1)} fps, ${(frames ? (now.reports - last.reports) / frames : 0).toFixed(2)} reports/frame, ` +
                    `merged ${now.merged - last.merged}, unchanged ${now.unchanged - last.unchanged}, ` +
                    `lights latency avg ${(lat.reduce((a, b) => a + b, 0) / (lat.length || 1)).toFixed(0)} max ${Math.max(0, ...lat).toFixed(0)} ms`,
            );
            last = now;
        }, 2000);
        try {
            await untilAborted(signal);
        } finally {
            window.clearInterval(timer);
            window.clearInterval(lights);
            window.clearInterval(report);
            s.maxFps = fpsBefore;
            s.blankAfter = 3000;
            m.lights.clear();
            await m.lights.flush();
            await s.clear();
        }
    },
};
