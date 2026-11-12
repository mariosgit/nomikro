import type { MaschineMikroMk3 } from './maschine_mikro_mk3';
import settings from './maschine_mikro_mk3.json';

type Lights = MaschineMikroMk3['lights'];

/** A scene is created fresh each time it plays; the returned function draws one frame at time t (seconds). */
interface Scene {
    name: string;
    seconds: number;
    start(): (l: Lights, t: number) => void;
}

const FPS = 30;
const STRIP_LEDS = 25;
const HUES = ['red', 'orange', 'yellow', 'lime', 'green', 'mint', 'cyan', 'turquoise', 'blue', 'plum', 'violet', 'purple', 'magenta', 'fuchsia'];
// enc-push / enc-touched have no LED; their slots would land on the pad LEDs
const BUTTONS = settings.button.order.filter((b) => !b.startsWith('enc-'));
const PADS = Array.from({ length: 16 }, (_, n) => n);

const hue = (i: number) => HUES[((Math.floor(i) % HUES.length) + HUES.length) % HUES.length];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Pad number -> grid position: x left→right, y top→bottom. Pad 0 is bottom left. */
const padXY = (n: number) => ({ x: n % 4, y: 3 - Math.floor(n / 4) });

// Brightness: pads/strip 1..3 (0 = off), buttons 0..4.
const pad = (l: Lights, n: number, val: number, color: string) => {
    const v = Math.round(clamp(val, 0, 3));
    if (v > 0) l.set('pad', n, v, color);
};
const strip = (l: Lights, i: number, val: number, color: string) => {
    const v = Math.round(clamp(val, 0, 3));
    if (v > 0) l.set('strip', i, v, color);
};
const button = (l: Lights, name: string, val: number) => l.set('button', name, Math.round(clamp(val, 0, 4)));

const rainbow: Scene = {
    name: 'Rainbow',
    seconds: 8,
    start: () => (l, t) => {
        for (const n of PADS) {
            const { x, y } = padXY(n);
            pad(l, n, 3, hue(x + y + t * 6));
        }
        for (let i = 0; i < STRIP_LEDS; i++) strip(l, i, 3, hue(i / 2 - t * 6));
        BUTTONS.forEach((b, i) => button(l, b, 2 + 2 * Math.sin(i * 0.6 - t * 6)));
    },
};

const ripple: Scene = {
    name: 'Ripple',
    seconds: 8,
    start: () => (l, t) => {
        const wave = (d: number) => 3 * Math.max(0, Math.sin(d * 2.2 - t * 7));
        const color = hue(t * 1.5);
        for (const n of PADS) {
            const { x, y } = padXY(n);
            pad(l, n, wave(Math.hypot(x - 1.5, y - 1.5)), color);
        }
        for (let i = 0; i < STRIP_LEDS; i++) strip(l, i, wave(Math.abs(i - 12) / 4), color);
        const pulse = 2 + 2 * Math.sin(t * 7);
        for (const b of BUTTONS) button(l, b, pulse);
    },
};

const scanner: Scene = {
    name: 'Scanner',
    seconds: 8,
    start: () => (l, t) => {
        const pos = 12 + 12 * Math.sin(t * 3); // 0..24 along the strip
        for (let i = 0; i < STRIP_LEDS; i++) strip(l, i, 3 - Math.abs(i - pos), 'red');
        const px = (pos / 24) * 3; // same sweep over the pad columns
        for (const n of PADS) pad(l, n, 3 - 2 * Math.abs(padXY(n).x - px), 'red');
        const head = Math.floor(t * 20) % BUTTONS.length;
        for (let k = 0; k < 4; k++) button(l, BUTTONS[(head - k + BUTTONS.length) % BUTTONS.length], 4 - k);
    },
};

const sparkle: Scene = {
    name: 'Sparkle',
    seconds: 8,
    start: () => {
        const pads = PADS.map(() => ({ v: 0, c: 'white' }));
        const leds = Array.from({ length: STRIP_LEDS }, () => ({ v: 0, c: 'white' }));
        const btns = BUTTONS.map(() => 0);
        const spark = (cells: { v: number; c: string }[], chance: number) => {
            for (const cell of cells) cell.v *= 0.82;
            if (Math.random() < chance) {
                const cell = cells[Math.floor(Math.random() * cells.length)];
                cell.v = 3;
                cell.c = Math.random() < 0.3 ? 'white' : hue(Math.random() * HUES.length);
            }
        };
        return (l) => {
            spark(pads, 0.35);
            spark(leds, 0.6);
            for (let i = 0; i < btns.length; i++) btns[i] = Math.random() < 0.03 ? 4 : btns[i] * 0.8;
            pads.forEach((p, n) => pad(l, n, p.v, p.c));
            leds.forEach((p, i) => strip(l, i, p.v, p.c));
            BUTTONS.forEach((b, i) => button(l, b, btns[i]));
        };
    },
};

const strobe: Scene = {
    name: 'Strobe',
    seconds: 4,
    start: () => (l, t) => {
        const step = Math.floor(t * 12);
        if (step % 2) return; // dark half of the flash
        const color = hue(step / 2);
        for (const n of PADS) pad(l, n, 3, color);
        for (let i = 0; i < STRIP_LEDS; i++) strip(l, i, 3, color);
        for (const b of BUTTONS) button(l, b, 4);
    },
};

export const SCENES: Scene[] = [rainbow, ripple, scanner, sparkle, strobe];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plays the scenes in a loop until the signal aborts, then turns all lights off. */
export async function runLightShow(maschine: MaschineMikroMk3, signal: AbortSignal, scenes: Scene[] = SCENES): Promise<void> {
    const l = maschine.lights;
    try {
        while (!signal.aborted) {
            for (const scene of scenes) {
                if (signal.aborted) break;
                console.log(`Light show: ${scene.name}`);
                maschine.screen.set(`Light show\n${scene.name}`);
                const draw = scene.start();
                const t0 = performance.now();
                for (let f = 0; !signal.aborted; f++) {
                    const t = (performance.now() - t0) / 1000;
                    if (t >= scene.seconds) break;
                    l.setAll({});
                    draw(l, t);
                    await l.update();
                    await sleep(t0 + ((f + 1) * 1000) / FPS - performance.now());
                }
            }
        }
    } finally {
        l.setAll({});
        await l.update();
    }
}
