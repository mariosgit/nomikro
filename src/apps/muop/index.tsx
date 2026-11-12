// μOp: a small PO-style groovebox. Drum track + melody track, 16 patterns, chains. Played on the device.
import React, { useEffect, useReducer, useState } from 'react';
import type { Color } from '../../maschine';
import { audioContext, audioRunning } from '../../engine/audio';
import { useDeviceTask } from '../../shell/device';
import type { AppDef, AppProps } from '../../shell/types';
import { MuOpController, type Cell } from './controller';
import { degreeName, loadSong } from './model';
import { DRUM_SOUNDS, Synth } from './sounds';

/** Pad numbers in screen order: top row first. Pad 0 = bottom left. */
const PADS_TOP_DOWN = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];

const CSS: Record<Color, string> = {
    off: 'transparent', red: '#ef4444', orange: '#f97316', orange_light: '#fdba74', yellow_warm: '#fbbf24', yellow: '#facc15',
    lime: '#a3e635', green: '#22c55e', mint: '#6ee7b7', cyan: '#22d3ee', turquoise: '#2dd4bf', blue: '#3b82f6', plum: '#c084fc',
    violet: '#8b5cf6', purple: '#a855f7', magenta: '#d946ef', fuchsia: '#ec4899', white: '#f4f4f5',
};

function useAudioRunning(): boolean {
    const [running, setRunning] = useState(audioRunning());
    useEffect(() => {
        const ctx = audioContext();
        const update = () => setRunning(ctx.state === 'running');
        ctx.addEventListener('statechange', update);
        update();
        return () => ctx.removeEventListener('statechange', update);
    }, []);
    return running;
}

function MuOp({ maschine }: AppProps) {
    const [ctl, setCtl] = useState<MuOpController | null>(null);
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    const audio = useAudioRunning();

    useDeviceTask(
        maschine,
        async (m, signal) => {
            const c = new MuOpController(m, loadSong(), new Synth(audioContext()));
            setCtl(c);
            try {
                await c.run(signal);
            } finally {
                setCtl(null);
            }
        },
        [],
        'muop',
    );
    useEffect(() => ctl?.subscribe(rerender), [ctl]);

    const v = ctl?.view;
    return (
        <div className="space-y-4">
            {!audio && (
                <button
                    onClick={() => audioContext().resume()}
                    className="w-full rounded-lg bg-orange-500 px-4 py-2 text-left text-sm font-medium text-white hover:bg-orange-600"
                >
                    Click here to enable audio (browsers start sound only after a click on the page)
                </button>
            )}

            <section className="flex flex-wrap gap-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="grid w-56 shrink-0 grid-cols-4 gap-2 self-start">
                    {PADS_TOP_DOWN.map((n) => (
                        <PadCell key={n} cell={v?.cells[n]} label={n + 1} />
                    ))}
                </div>
                {v ? (
                    <dl className="grid flex-1 grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 text-sm">
                        <Stat k="Track" v={v.track === 'drums' ? `Drums · ${DRUM_SOUNDS[v.drumSound].name}` : `Melody · pen ${degreeName(v.pen)}`} />
                        <Stat k="Pads" v={v.stepMode ? 'Steps (STEP)' : 'Play'} />
                        <Stat
                            k="Transport"
                            v={`${v.playing ? '▶ playing' : '■ stopped'}${v.recording ? ' · ● rec' : ''}${v.metronome ? ' · metronome' : ''}${v.step >= 0 ? ` · step ${v.step + 1}` : ''}`}
                        />
                        <Stat k="Pattern" v={String(v.pattern + 1)} />
                        <Stat
                            k="Chain"
                            v={`${v.chain.map((p) => p + 1).join(' ')}${v.pendingChain ? ` → next ${v.pendingChain.map((p) => p + 1).join(' ')}` : ''}`}
                        />
                        <Stat k="Tempo" v={`${v.bpm} BPM · swing ${v.swing}% · volume ${Math.round(v.volume * 100)}`} />
                        <Stat k="Display" v={v.message.replace('\n', ' · ')} />
                    </dl>
                ) : (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Connect the device to play.</p>
                )}
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-2 font-semibold">Controls</h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <Help k="PAD MODE / KEYBOARD" v="Drum track / melody track" />
                    <Help k="Pads" v="Play: drums on pads 1–8 (selects the sound), melody = A minor scale over 16 pads" />
                    <Help k="STEP" v="Pads = 16 steps. Drums: tap toggles the selected sound. Melody: tap writes the last played note, tap again clears, hold + encoder changes the note" />
                    <Help k="PLAY / STOP / REC" v="Play/pause · stop and rewind · live recording into the nearest step while playing" />
                    <Help k="PATTERN + pad" v="Select pattern (switches at the end of the bar while playing). Tap several pads while holding = chain" />
                    <Help k="DUPLICATE + pad" v="Copy the current pattern there" />
                    <Help k="ERASE + pad" v="Clear that drum sound (melody track: clear the melody)" />
                    <Help k="TEMPO / SWING / VOLUME + encoder" v="Tempo, swing 50–75 %, master volume" />
                    <Help k="Touch strip" v="Low-pass filter while touched" />
                    <Help k="SHIFT + TAP" v="Metronome on/off (TAP blinks on the beat while on)" />
                    <Help k="Button lights" v="Dim = usable, bright = active / held" />
                </dl>
            </section>
        </div>
    );
}

function PadCell({ cell, label }: { cell: Cell | undefined; label: number }) {
    const color = cell && cell.level > 0 ? CSS[cell.color] : undefined;
    return (
        <div
            className="relative aspect-square rounded-md bg-zinc-200 dark:bg-zinc-800"
            style={color ? { backgroundColor: color, opacity: 0.35 + 0.65 * (cell!.level / 3) } : undefined}
        >
            <span className="absolute top-0.5 left-1 text-[10px] text-zinc-500 mix-blend-difference">{label}</span>
        </div>
    );
}

const Stat = ({ k, v }: { k: string; v: string }) => (
    <>
        <dt className="text-zinc-500 dark:text-zinc-400">{k}</dt>
        <dd className="font-medium">{v}</dd>
    </>
);

const Help = ({ k, v }: { k: string; v: string }) => (
    <>
        <dt className="font-mono text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">{k}</dt>
        <dd>{v}</dd>
    </>
);

export const muop: AppDef = {
    label: 'μOp',
    description: 'The μcroOperator: PO-style groovebox, drums + melody, 16 patterns, chains.',
    Component: MuOp,
};
