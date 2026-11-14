// Lab mode `two-sliders`: can the touch strip set two values at once (e.g. VARIATION déjà vu + density)?
// Two sliders A / B on the display, `< >` switches the mapping, the strip LEDs show the fingers (cyan = A, magenta = B).
// Raw positions + values go to the log. Finger tracking + pinch: `StripFingers` (src/maschine/strip.ts).
// Tried by hand: drag (no jumps) and pinch are usable, split works; "left finger = A, right = B" was confusing (dropped).
// μOp VARIATION uses pinch: one finger = déjà vu, two = déjà vu (center) + density (width).
import { STRIP_LEDS, STRIP_MAX, StripFingers, stripValue } from '../../../maschine';
import { untilAborted, type Mode } from './types';

type Mapping = 'pinch' | 'drag' | 'split';

const MAPPINGS: { id: Mapping; name: string; help: string }[] = [
    { id: 'pinch', name: 'Pinch', help: 'center of the fingers = A, distance = B; one finger = A' },
    { id: 'drag', name: 'Drag', help: 'relative: 1st finger down moves A, 2nd moves B, by how far they slide (no jump on touch)' },
    { id: 'split', name: 'Split', help: 'left half = A, right half = B (one finger per half)' },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const led = (p: number) => Math.round(stripValue(p) * (STRIP_LEDS - 1));

export const twoSliders: Mode = {
    label: 'Test: two sliders on the strip',
    help:
        'Two values (A = déjà vu, B = density) from the touch strip, shown as bars on the display. `< >` on the device or param ' +
        'map=pinch|drag|split switches the mapping. Strip LEDs: the finger for A cyan, for B magenta (tracked: the device ' +
        'sorts the two positions left → right). Raw positions in the log.',
    async run(m, signal, ctx) {
        let map = Math.max(0, MAPPINGS.findIndex((x) => x.id === ctx.params.map));
        const v = [0.25, 0.5];
        const strip = new StripFingers();
        let raw = { p1: 0, p2: 0 };
        let lastLog = 0;

        const show = () => {
            const mp = MAPPINGS[map];
            m.screen
                .draw((g, w) => {
                    g.font = '10px monospace';
                    g.fillText(`${mp.name}  ${raw.p1 || '-'} ${raw.p2 || '-'}`, 0, 9);
                    const bar = (y: number, label: string, x: number) => {
                        g.fillText(label, 0, y + 7);
                        const x0 = 22;
                        const bw = w - x0 - 22;
                        g.strokeRect(x0 + 0.5, y + 0.5, bw - 1, 7);
                        g.fillRect(x0, y, Math.round(x * bw), 8);
                        g.fillText(String(Math.round(x * 100)).padStart(3), w - 20, y + 7);
                    };
                    bar(13, 'DV', v[0]);
                    bar(24, 'DN', v[1]);
                })
                .catch(() => {});
        };

        const lights = () => {
            for (let i = 0; i < STRIP_LEDS; i++) m.lights.strip(i, 'off');
            if (MAPPINGS[map].id === 'split') m.lights.strip((STRIP_LEDS - 1) / 2, 'white', 1); // the middle
            for (const f of strip.fingers) m.lights.strip(led(f.pos), f.slot ? 'magenta' : 'cyan', 3);
            m.lights.button('arrow_left', 1);
            m.lights.button('arrow_right', 1);
            m.lights.flush().catch(() => {});
        };

        const apply = () => {
            switch (MAPPINGS[map].id) {
                case 'pinch': {
                    const p = strip.pinch();
                    if (p) [v[0], v[1]] = [p.center, p.width];
                    const one = strip.single(); // not after a pinch: lifting one finger doesn't jump
                    if (one !== null) v[0] = one;
                    break;
                }
                case 'drag':
                    // each tracked finger moves its own slider (1st down = A, 2nd = B), however they cross
                    for (const f of strip.fingers) v[f.slot] = clamp01(v[f.slot] + (f.pos - f.prev) / (STRIP_MAX - 1));
                    break;
                case 'split': {
                    const mid = (STRIP_MAX + 1) / 2;
                    for (const { pos } of strip.fingers) {
                        if (pos < mid) v[0] = clamp01((pos - 1) / (mid - 1 - 8)); // a small gap in the middle
                        else v[1] = clamp01((pos - mid - 8) / (STRIP_MAX - mid - 8));
                    }
                    break;
                }
            }
        };

        const offStrip = m.input.on('strip', (e) => {
            raw = { p1: e.position, p2: e.position2 };
            strip.update(e.position, e.position2);
            apply();
            show();
            lights();
            const now = performance.now();
            if (now - lastLog > 100 || !e.position) {
                lastLog = now;
                const who = strip.fingers.map((f) => `${f.slot ? 'B' : 'A'}@${f.pos}`).join(' ');
                ctx.log(`${MAPPINGS[map].id}: p1 ${e.position} p2 ${e.position2} [${who}] → DV ${Math.round(v[0] * 100)} DN ${Math.round(v[1] * 100)}`);
            }
        });
        const offButtons = m.input.on('buttonDown', (e) => {
            if (e.button !== 'arrow_left' && e.button !== 'arrow_right') return;
            map = (map + (e.button === 'arrow_right' ? 1 : MAPPINGS.length - 1)) % MAPPINGS.length;
            ctx.log(`mapping ${MAPPINGS[map].name}: ${MAPPINGS[map].help}`);
            m.screen.set(`${MAPPINGS[map].name}\n${MAPPINGS[map].help.split(/[;,(]/)[0].slice(0, 21)}`).catch(() => {});
            setTimeout(show, 1500);
            lights();
        });

        ctx.log(`mapping ${MAPPINGS[map].name}: ${MAPPINGS[map].help}`);
        show();
        lights();
        try {
            await untilAborted(signal);
        } finally {
            offStrip();
            offButtons();
            m.lights.clear();
            await m.lights.flush().catch(() => {});
            await m.screen.clear().catch(() => {});
        }
    },
};
