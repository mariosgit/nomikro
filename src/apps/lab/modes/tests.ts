// Hardware test modes: for checking the device on camera / with the dev log (see CLAUDE.md).
import { COLORS, LED_BUTTONS, STRIP_LEDS, STRIP_MAX, type Color, type LedButton, type MaschineMikroMk3 } from '../../../maschine';
import { toHex } from '../../../dev/devlog';
import { untilAborted, type Mode, type ModeContext } from './types';

/** Shows a static test frame and keeps it (incl. screen text) until aborted. */
async function holdFrame(m: MaschineMikroMk3, signal: AbortSignal, screenText: string, draw: () => void): Promise<void> {
    m.screen.blankAfter = 0;
    try {
        m.lights.clear();
        draw();
        await m.lights.flush();
        await m.screen.set(screenText);
        await untilAborted(signal);
    } finally {
        m.screen.blankAfter = 3000;
        m.lights.clear();
        await m.lights.flush();
        await m.screen.clear();
    }
}

/** Pad number -> grid position: x left→right, y top→bottom. Pad 0 is bottom left. */
const padAt = (x: number, y: number) => (3 - y) * 4 + x;

const colorByte = (color: Color, level: number) => 4 * COLORS.indexOf(color) + level;

const parseBytes = (s: string | undefined, fallback: number[]) =>
    s ? s.split(',').map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v >= 0 && v <= 255) : fallback;

// Vertical button column left of the pads (top → bottom), the easiest group to compare on camera.
const LADDER: LedButton[] = ['scene', 'pattern', 'events', 'variation', 'duplicate', 'select', 'solo', 'mute'];

/**
 * Input monitor: pressed pads red, released green; encoder counter; touch strip lit at the finger.
 * Display: held pads / encoder count + strip value. Decoded input goes to the log. Returns the cleanup function.
 */
async function monitorInput(m: MaschineMikroMk3, ctx: ModeContext, title: string): Promise<() => Promise<void>> {
    const held = new Set<number>();
    let encoder = 0;
    let strip = 0;
    let lastButtons = '';
    let lastHex = '';

    m.screen.blankAfter = 0;
    m.lights.clear();
    await m.lights.flush();
    await m.screen.set(title);

    const show = () =>
        m.screen.set(`Pads: ${[...held].sort((a, b) => a - b).join(' ') || '-'}\nEnc ${encoder}  Strip ${strip || '-'}`);

    m.onRawInput = (reportId, bytes) => {
        if (bytes.length === 13) {
            lastHex = toHex(bytes); // logged by the button callback
            return;
        }
        if (bytes.length !== 63) return;
        // Pad reports stream pressure; only keep the ones with a press/release in them
        const events = m.pads.decode(bytes) ?? [];
        if (!events.some((e) => e.pressed || e.released)) return;
        ctx.log(
            `pads: ${events.map((e) => `${e.pad_nb}${e.pressed ? '↓' : e.released ? '↑' : '~'}${e.pad_val}`).join(' ')}`,
            { reportId, hex: toHex(bytes), events },
        );
    };

    m.setButtonCallback((b) => {
        const parts: string[] = [];
        const pressed = b.btn_pressed.join(', ');
        if (pressed !== lastButtons) parts.push(`buttons: ${pressed || '-'}`);
        lastButtons = pressed;

        if (b.encoder_move) {
            encoder += b.encoder_move;
            parts.push(`enc ${b.encoder_move > 0 ? '+' : ''}${b.encoder_move} → ${encoder} (pos ${b.encoder_pos})`);
        }

        if (b.strip_pos_1 !== strip) {
            strip = b.strip_pos_1;
            parts.push(`strip ${strip}${b.strip_pos_2 ? ` / ${b.strip_pos_2}` : ''} (t=${b.time})`);
            for (let i = 0; i < STRIP_LEDS; i++) m.lights.strip(i, 'cyan', 0);
            if (strip) m.lights.strip(Math.min(STRIP_LEDS - 1, Math.round(((strip - 1) / (STRIP_MAX - 1)) * (STRIP_LEDS - 1))), 'cyan');
            m.lights.flush();
        }

        if (!parts.length) return;
        ctx.log(parts.join(' | '), { hex: lastHex, state: b });
        show();
    });

    m.setPadCallback((pad) => {
        if (pad.pressed) {
            held.add(pad.pad_nb);
            m.lights.pad(pad.pad_nb, 'red');
        } else if (pad.released) {
            held.delete(pad.pad_nb);
            m.lights.pad(pad.pad_nb, 'green');
        } else return;
        m.lights.flush();
        show();
    });

    return async () => {
        m.onRawInput = null;
        m.setPadCallback(() => {});
        m.setButtonCallback(null);
        m.screen.blankAfter = 3000;
        m.lights.clear();
        await m.lights.flush();
        await m.screen.clear();
    };
}

export const TEST_MODES = {
    'pad-levels': {
        label: 'Test: pad levels',
        help: 'Rows (top→bottom) red, green, blue, white. Columns (left→right) raw level 0..3 = byte 4·color + level. Is column 0 off or dim?',
        run: (m, signal, ctx) =>
            holdFrame(m, signal, 'Pad levels\nlvl 0 1 2 3 >', () => {
                const rows: Color[] = ['red', 'green', 'blue', 'white'];
                rows.forEach((color, y) => {
                    for (let x = 0; x < 4; x++) m.lights.raw('pad', padAt(x, y), colorByte(color, x));
                });
                ctx.log(`pad levels: rows ${rows.join(',')} × level 0..3`);
            }),
    },

    strip: {
        label: 'Test: strip direction',
        help: 'Strip LED 0 = red, LED 1 = green, LED 24 = blue.',
        run: (m, signal, ctx) =>
            holdFrame(m, signal, 'Strip test\n0=red 24=blue', () => {
                m.lights.strip(0, 'red');
                m.lights.strip(1, 'green');
                m.lights.strip(STRIP_LEDS - 1, 'blue');
                ctx.log('strip: 0=red, 1=green, 24=blue');
            }),
    },

    buttons: {
        label: 'Test: button bytes',
        help: 'Raw bytes on the button column left of the pads (SCENE top … MUTE bottom). Param values=a,b,c,… (up to 8).',
        run(m, signal, ctx) {
            const values = parseBytes(ctx.params.values, [1, 4, 8, 16, 32, 64, 127, 255]).slice(0, LADDER.length);
            return holdFrame(m, signal, `Btn bytes\n${values.join(' ')}`, () => {
                values.forEach((v, i) => m.lights.raw('button', LED_BUTTONS.indexOf(LADDER[i]), v));
                ctx.log(`buttons: ${LADDER.slice(0, values.length).map((b, i) => `${b}=${values[i]}`).join(' ')}`);
            });
        },
    },

    input: {
        label: 'Test: input monitor',
        help: 'Press pads (also 2–3 at once) and buttons. Pressed pads light red, released green. Raw reports go to .devlog/hw.jsonl.',
        async run(m, signal, ctx) {
            const stop = await monitorInput(m, ctx, 'Input test\npress pads');
            try {
                await untilAborted(signal);
            } finally {
                await stop();
            }
        },
    },

    replay: {
        label: 'Test: replay input',
        help: 'Replays recorded input reports (pads + buttons) from .devlog/hw.jsonl (input mode) with original timing through the input monitor. Params: from, to (HH:MM:SS), speed.',
        async run(m, signal, ctx) {
            const from = ctx.params.from ?? '00:00:00';
            const to = ctx.params.to ?? '99';
            const speed = Number(ctx.params.speed ?? 1);
            const text = await (await fetch('/__hw/devlog')).text();
            const reports = text
                .split('\n')
                .filter(Boolean)
                .map((l) => JSON.parse(l))
                .filter((r) => r.kind === 'event' && r.data?.mode === 'input' && [1, 2].includes(r.data?.data?.reportId))
                .filter((r) => r.t.slice(11, 19) >= from && r.t.slice(11, 19) <= to)
                .map((r) => ({
                    at: Date.parse(r.t),
                    reportId: r.data.data.reportId as number,
                    bytes: Uint8Array.from(r.data.data.hex.split(' '), (h: string) => parseInt(h, 16)),
                }));
            const stop = await monitorInput(m, ctx, `Replay\n${reports.length} reports`);
            try {
                ctx.log(`replaying ${reports.length} input reports ${from}..${to} at ${speed}×`);
                const t0 = performance.now();
                for (const r of reports) {
                    if (signal.aborted) break;
                    const wait = (r.at - reports[0].at) / speed - (performance.now() - t0);
                    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
                    m.injectInput(r.reportId, r.bytes);
                }
                ctx.log('replay done: all pads should be green (none red)');
                await untilAborted(signal);
            } finally {
                await stop();
            }
        },
    },

    bench: {
        label: 'Test: write bench',
        help: 'Measures output report timing: lights alone, screen alone, both at once. Results go to the dev log.',
        async run(m, signal, ctx) {
            const outputs = m.device?.collections.flatMap((c) =>
                (c.outputReports ?? []).map((r) => ({
                    id: r.reportId,
                    bytes: (r.items ?? []).reduce((n, it) => n + ((it.reportSize ?? 0) * (it.reportCount ?? 0)) / 8, 0),
                })),
            );
            ctx.log(`output reports: ${JSON.stringify(outputs)}`, outputs);

            const samples: { id: number; ms: number; error?: string }[] = [];
            m.onWrite = (id, _size, ms, error) => samples.push({ id, ms, error: error ? String(error) : undefined });
            const report = (name: string, wallMs: number) => {
                const by = (id: number) => samples.filter((s) => s.id === id).map((s) => s.ms);
                const stat = (xs: number[]) =>
                    xs.length ? `n=${xs.length} avg=${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)} max=${Math.max(...xs).toFixed(1)}ms` : '-';
                const errors = samples.filter((s) => s.error);
                ctx.log(`${name}: total ${wallMs.toFixed(0)}ms | lights ${stat(by(0x80))} | screen ${stat(by(0xE0))}${errors.length ? ` | ${errors.length} errors: ${errors[0].error}` : ''}`);
                samples.length = 0;
            };
            const time = async (name: string, fn: () => Promise<unknown>) => {
                const t0 = performance.now();
                await fn();
                report(name, performance.now() - t0);
            };
            m.screen.blankAfter = 0;
            try {
                await time('lights ×30 sequential', async () => {
                    for (let i = 0; i < 30 && !signal.aborted; i++) {
                        m.lights.clear();
                        m.lights.pad(i % 16, 'blue');
                        await m.lights.flush();
                    }
                });
                await time('screen ×5 sequential', async () => {
                    for (let i = 0; i < 5 && !signal.aborted; i++) await m.screen.set(`Bench\nframe ${i}`);
                });
                await time('lights ×30 burst (coalesced)', async () => {
                    const all: Promise<void>[] = [];
                    for (let i = 0; i < 30; i++) {
                        m.lights.clear();
                        m.lights.pad(i % 16, 'green');
                        all.push(m.lights.flush());
                    }
                    await Promise.all(all);
                });
                await time('screen + lights concurrently ×5', async () => {
                    for (let i = 0; i < 5 && !signal.aborted; i++) {
                        m.lights.clear();
                        m.lights.pad(i, 'red');
                        await Promise.all([m.screen.set(`Bench\nmixed ${i}`), m.lights.flush()]);
                    }
                });
                const latency: number[] = [];
                await time('lights latency while screen frames are written ×5', async () => {
                    for (let i = 0; i < 5 && !signal.aborted; i++) {
                        const frame = m.screen.set(`Bench\nlatency ${i}`);
                        await new Promise((r) => setTimeout(r, 5)); // screen half is on the wire now
                        m.lights.clear();
                        m.lights.pad(i, 'white');
                        const t0 = performance.now();
                        await m.lights.flush();
                        latency.push(performance.now() - t0);
                        await frame;
                    }
                });
                ctx.log(`lights latency during screen: ${latency.map((x) => x.toFixed(0)).join(', ')} ms`);
                ctx.log('bench done');
                await untilAborted(signal);
            } finally {
                m.onWrite = null;
                m.screen.blankAfter = 3000;
                m.lights.clear();
                await m.lights.flush();
                await m.screen.clear();
            }
        },
    },

    stress: {
        label: 'Test: lights + screen stress',
        help: 'Random red pads interleaved with screen frames, ending with ALL pads green. Any red pad left = a lost lights report.',
        async run(m, signal, ctx) {
            const rounds = Number(ctx.params.rounds ?? 40);
            const withScreen = ctx.params.screen !== '0';
            m.screen.blankAfter = 0;
            try {
                for (let i = 0; i < rounds && !signal.aborted; i++) {
                    m.lights.clear();
                    for (let n = 0; n < 16; n++) if (Math.random() < 0.5) m.lights.pad(n, 'red');
                    const writes = [m.lights.flush()];
                    if (withScreen) writes.push(m.screen.set(`Stress\nround ${i}`));
                    await Promise.all(writes);
                }
                m.lights.clear();
                for (let n = 0; n < 16; n++) m.lights.pad(n, 'green');
                await Promise.all([m.lights.flush(), withScreen ? m.screen.set('Stress\ndone: green?') : Promise.resolve()]);
                ctx.log(`stress done (${rounds} rounds, screen ${withScreen ? 'on' : 'off'}): all pads should be green`);
                await untilAborted(signal);
            } finally {
                m.screen.blankAfter = 3000;
                m.lights.clear();
                await m.lights.flush();
                await m.screen.clear();
            }
        },
    },
} satisfies Record<string, Mode>;
