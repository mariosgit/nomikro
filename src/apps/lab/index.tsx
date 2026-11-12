// Lab: light show + hardware test modes (the original demo app). Route: #/lab/<mode>?<params>
import React, { useState } from 'react';
import { useDeviceTask } from '../../shell/device';
import type { AppDef, AppProps } from '../../shell/types';
import { devlog } from '../../dev/devlog';
import { MODES, isModeName, type ModeName } from './modes';

const DEFAULT_MODE: ModeName = 'show';
const MODE_NAMES = Object.keys(MODES) as ModeName[];
const isTest = (name: ModeName) => MODES[name].label.startsWith('Test: ');
const shortLabel = (name: ModeName) => MODES[name].label.replace(/^Test: /, '');

function Lab({ maschine, path, params, navigate, routeKey }: AppProps) {
    const mode = isModeName(path) ? path : DEFAULT_MODE;
    const [lines, setLines] = useState<string[]>([]);

    useDeviceTask(
        maschine,
        async (m, signal) => {
            setLines([]);
            const log = (line: string, data?: unknown) => {
                setLines((prev) => [line, ...prev].slice(0, 30));
                devlog('event', { mode, line, data });
            };
            devlog('mode', { mode, params });
            await MODES[mode].run(m, signal, { params, log });
        },
        [mode, routeKey],
        `lab/${mode}`,
    );

    const entries = Object.entries(params);

    return (
        <div className="space-y-4">
            <nav className="flex flex-wrap items-center gap-1" aria-label="Lab modes">
                {MODE_NAMES.filter((n) => !isTest(n)).map((name) => (
                    <button
                        key={name}
                        onClick={() => navigate(name)}
                        aria-current={name === mode ? 'page' : undefined}
                        className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                            name === mode
                                ? 'bg-orange-500 text-white'
                                : 'text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white'
                        }`}
                    >
                        {MODES[name].label}
                    </button>
                ))}
                <select
                    aria-label="Tests"
                    value={isTest(mode) ? mode : ''}
                    onChange={(e) => navigate(e.target.value)}
                    className={`rounded-md border px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                        isTest(mode)
                            ? 'border-orange-500 bg-orange-500 text-white'
                            : 'border-zinc-300 bg-transparent text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
                    }`}
                >
                    <option value="" disabled>
                        Tests…
                    </option>
                    {MODE_NAMES.filter(isTest).map((name) => (
                        <option key={name} value={name} className="text-zinc-900">
                            {shortLabel(name)}
                        </option>
                    ))}
                </select>
            </nav>

            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h1 className="text-xl font-semibold">{MODES[mode].label}</h1>
                <p className="mt-1 text-zinc-600 dark:text-zinc-300">{MODES[mode].help}</p>
                {entries.length > 0 && (
                    <dl className="mt-3 flex flex-wrap gap-2 text-xs">
                        {entries.map(([k, v]) => (
                            <div key={k} className="rounded bg-zinc-100 px-2 py-0.5 font-mono dark:bg-zinc-800">
                                <dt className="inline text-zinc-500 dark:text-zinc-400">{k}=</dt>
                                <dd className="inline">{v}</dd>
                            </div>
                        ))}
                    </dl>
                )}
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="border-b border-zinc-200 px-5 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:text-zinc-400">
                    Events
                </h2>
                <pre className="max-h-[60vh] min-h-24 overflow-auto px-5 py-3 font-mono text-xs leading-relaxed">
                    {lines.length ? lines.join('\n') : <span className="text-zinc-400 dark:text-zinc-500">No events yet.</span>}
                </pre>
            </section>
        </div>
    );
}

export const lab: AppDef = {
    label: 'Lab',
    title: 'Lab - Lights & Hardware Tests',
    description: 'Light show and hardware tests.',
    Component: Lab,
    // curl 'localhost:9000/__hw/run?mode=<mode>&<params>' (mode without app= goes to the lab)
    bridge: ({ mode = DEFAULT_MODE, ...params }) => {
        if (!isModeName(mode)) devlog('error', `unknown mode "${mode}", known: ${MODE_NAMES.join(', ')}`);
        return { path: mode, params };
    },
};
