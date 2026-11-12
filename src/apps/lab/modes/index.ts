// App modes, shown as buttons on the page in this order.
// Switch from the page, or from the terminal: curl 'localhost:9000/__hw/run?mode=buttons&values=1,2,4'
import { runLightShow } from './lightshow';
import { TEST_MODES } from './tests';
import { untilAborted, type Mode } from './types';

export type { Mode, ModeContext } from './types';

export const MODES = {
    show: {
        label: 'Light show',
        help: 'Animated scenes in a loop.',
        run: (m, signal) => runLightShow(m, signal),
    },

    demo: {
        label: 'Demo',
        help: 'The original static lights + "Hello World" demo.',
        async run(m, signal) {
            const l = m.lights;
            try {
                l.clear();
                l.button('stop', 2);
                l.strip(1, 'blue');
                l.pad(0, 'green');
                l.pad(6, 'orange');
                l.strip(5, 'green');
                l.button('scene', 0);
                l.button('pattern', 1);
                l.button('events', 2);
                l.button('variation', 3);
                l.button('duplicate', 4);
                await l.flush();
                await m.screen.set("Hello World!\nIt's working");
                await untilAborted(signal);
            } finally {
                l.clear();
                await l.flush();
            }
        },
    },

    ...TEST_MODES,

    off: {
        label: 'Off',
        help: 'All lights off.',
        async run(m, signal) {
            m.lights.clear();
            await m.lights.flush();
            await m.screen.clear();
            await untilAborted(signal);
        },
    },
} satisfies Record<string, Mode>;

export type ModeName = keyof typeof MODES;
export const isModeName = (s: string): s is ModeName => s in MODES;
