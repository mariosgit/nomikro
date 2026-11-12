// Starter: the smallest useful app. Copy this folder to start a new idea, then register it in ../index.ts.
// Pads light up while pressed, the page mirrors them.
import React, { useState } from 'react';
import { useDeviceTask } from '../../shell/device';
import type { AppDef, AppProps } from '../../shell/types';

/** Pad number -> grid position: pad 0 is bottom left, pad 12 top left. */
const PADS_TOP_DOWN = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];

function Starter({ maschine }: AppProps) {
    const [held, setHeld] = useState<ReadonlySet<number>>(new Set());

    // Owns the device while this app is shown. The shell releases callbacks and clears the lights afterwards.
    useDeviceTask(
        maschine,
        async (m, signal) => {
            const down = new Set<number>();
            m.screen.set('Starter\npress pads');
            m.setPadCallback((pad) => {
                if (pad.pressed) down.add(pad.pad_nb);
                else if (pad.released) down.delete(pad.pad_nb);
                else return;
                m.lights.pad(pad.pad_nb, down.has(pad.pad_nb) ? 'orange' : 'off');
                m.lights.flush();
                setHeld(new Set(down));
            });
            await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
            setHeld(new Set());
        },
        [],
        'starter',
    );

    return (
        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h1 className="text-xl font-semibold">Starter</h1>
            <p className="mt-1 text-zinc-600 dark:text-zinc-300">
                Template for a new idea: <code className="text-sm">src/apps/starter/</code>. Press pads.
            </p>
            <div className="mt-4 grid w-48 grid-cols-4 gap-2">
                {PADS_TOP_DOWN.map((n) => (
                    <div
                        key={n}
                        className={`aspect-square rounded-md transition-colors ${
                            held.has(n) ? 'bg-orange-500' : 'bg-zinc-200 dark:bg-zinc-800'
                        }`}
                        title={`pad ${n}`}
                    />
                ))}
            </div>
        </section>
    );
}

export const starter: AppDef = {
    label: 'Starter',
    description: 'Template for a new idea: pads light up while pressed.',
    Component: Starter,
};
