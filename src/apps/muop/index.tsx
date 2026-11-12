// μOp: a small PO-style groovebox. 16 tracks (drums, bass, chords, lead, …), 16 patterns, chains. Played on the device.
import React, { useEffect, useReducer, useState } from 'react';
import type { Color } from '../../maschine';
import { audioContext, audioRunning } from '../../engine/audio';
import { useDeviceTask } from '../../shell/device';
import type { AppDef, AppProps } from '../../shell/types';
import { MuOpController, trackColor, type Cell, type MuOpView } from './controller';
import { chordName, degreeName, loadSong } from './model';
import { DRUM_SOUNDS, Sounds, soundsFor } from './sounds';
import { FX } from './fx';

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
            const c = new MuOpController(m, loadSong(), new Sounds(audioContext()));
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
                        <Stat k="Track" v={trackSummary(v)} />
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
                        <Stat k="Tempo" v={`${v.bpm} BPM · swing ${v.swing}% · master volume ${Math.round(v.volume * 100)}`} />
                        <Stat k="FX" v={v.fx.length ? v.fx.join(' · ') : '—'} />
                        <Stat k="Display" v={v.message.replace('\n', ' · ')} />
                    </dl>
                ) : (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Connect the device to play.</p>
                )}
            </section>

            {v && ctl && (
                <section className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <table className="w-full text-sm">
                        <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                            <tr className="border-b border-zinc-200 dark:border-zinc-800">
                                <th className="px-4 py-2 font-medium">#</th>
                                <th className="px-2 py-2 font-medium">Track</th>
                                <th className="px-2 py-2 font-medium">Sound</th>
                                <th className="px-4 py-2 text-right font-medium">Volume</th>
                            </tr>
                        </thead>
                        <tbody>
                            {v.tracks.map((t, i) =>
                                t.kind ? (
                                    <tr
                                        key={i}
                                        onClick={() => ctl.selectTrack(i)}
                                        className={`cursor-pointer border-b border-zinc-100 last:border-0 dark:border-zinc-800/60 ${
                                            i === v.track ? 'bg-orange-50 dark:bg-orange-950/40' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                                        }`}
                                    >
                                        <td className="px-4 py-1.5 text-zinc-500 dark:text-zinc-400">
                                            <span className="mr-2 inline-block size-2 rounded-full" style={{ backgroundColor: CSS[trackColor(t)] }} />
                                            {i + 1}
                                        </td>
                                        <td className="px-2 py-1.5 font-medium">
                                            {t.name} <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{t.kind}</span>
                                        </td>
                                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                            <SoundSelect value={t.sound} random={t.random} defs={soundsFor(t.kind)} onChange={(id) => ctl.setSound(i, id)} />
                                        </td>
                                        <td className="px-4 py-1.5 text-right tabular-nums">{Math.round(t.level * 100)}</td>
                                    </tr>
                                ) : null,
                            )}
                            <tr>
                                <td colSpan={4} className="px-4 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                    Tracks {v.tracks.findIndex((t) => !t.kind) + 1}–16: empty (for later)
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </section>
            )}

            <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-2 font-semibold">Controls</h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <Help k="SELECT + pad" v="Select track 1–16 (pads show the tracks while SELECT is held). Everything below acts on the selected track" />
                    <Help k="PAD MODE / KEYBOARD / CHORDS" v="Shortcuts: drums track · bass ↔ lead · chords track" />
                    <Help k="Pads" v="Play. Drums: pads 1–8 (selects the sound). Bass / lead: A minor scale over 16 pads. Chords: pads 1–8 triads (Am B° C Dm Em F G Am), 9–16 the same as 7th chords" />
                    <Help k="STEP" v="Pads = 16 steps. Drums: tap toggles the selected sound. Notes / chords: tap writes the last played note / chord, tap again clears, hold + encoder changes it" />
                    <Help k="PLAY / STOP / REC" v="Play/pause · stop and rewind · live recording into the nearest step while playing" />
                    <Help k="PATTERN + pad" v="Select pattern (switches at the end of the bar while playing). Tap several pads while holding = chain" />
                    <Help k="DUPLICATE + pad" v="Copy the current pattern there" />
                    <Help k="ERASE + pad" v="Clear that drum sound (notes / chords track: clear the track in this pattern)" />
                    <Help k="TEMPO / SWING + encoder" v="Tempo, swing 50–75 %" />
                    <Help k="VOLUME + encoder" v="Volume of the current track (saved in the song). SHIFT + VOLUME + encoder: master volume" />
                    <Help k="Touch strip" v="Low-pass filter while touched" />
                    <Help k="SHIFT + TAP" v="Metronome on/off (TAP blinks on the beat while on)" />
                    <Help k="SEARCH" v="Next sound for the current track (SHIFT + SEARCH: previous; also selectable in the track list)" />
                    <Help k="STAR" v="Random variation of the current track's sound: temporary, not saved (STAR lit while active, SEARCH or a reload goes back)" />
                    <Help k="PERFORM + pad" v="Punch-in FX while held (pads show the FX, active = white). Pads 1–8 act on the selected track, 9–16 on the whole mix. Release PERFORM first to keep it until the pad is let go. PERFORM lit while an FX runs" />
                    <Help k="REC + PERFORM + pad" v="While playing: the FX is recorded into the pattern's steps and comes back every loop" />
                    <Help k="ERASE + PERFORM" v="Clear all recorded FX of the current pattern (ERASE + PERFORM + pad: only that FX)" />
                    <Help k="Button lights" v="Dim = usable, bright = active / held" />
                </dl>
                <h3 className="mt-4 mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">PERFORM pads (as on the device)</h3>
                <div className="grid max-w-md grid-cols-4 gap-1.5">
                    {PADS_TOP_DOWN.map((pad) => (
                        <div key={pad} className="rounded-md border-l-4 bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800" style={{ borderColor: CSS[FX[pad].color] }}>
                            <span className="text-zinc-500 dark:text-zinc-400">{pad + 1}</span> {FX[pad].name}
                        </div>
                    ))}
                </div>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    1–8 selected track: loops repeat the last 1/2/4/8 steps, retrig repeats the step 2×/3×, reverse plays backwards, half time stretches. 9–16 mix: filter sweeps over a bar, gate chops 1/16, pump ducks every beat, echo is dotted 1/8, slow down = tape stop.
                </p>
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

function SoundSelect({
    value,
    random,
    defs,
    onChange,
}: {
    value: string;
    random: boolean;
    defs: readonly { id: string; name: string; engine: string }[];
    onChange(id: string): void;
}) {
    return (
        <label className="inline-flex items-center gap-1">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="rounded-md border border-zinc-300 bg-transparent px-1.5 py-0.5 text-sm dark:border-zinc-700"
            >
                {defs.map((d) => (
                    <option key={d.id} value={d.id} className="text-zinc-900">
                        {d.name} ({d.engine})
                    </option>
                ))}
            </select>
            {random && <span className="text-xs font-medium text-orange-500">★ random</span>}
        </label>
    );
}

/** "Bass · pen A1" / "Drums · Kick" / "Chords · pen Am" */
function trackSummary(v: MuOpView): string {
    const t = v.tracks[v.track];
    const head = `${v.track + 1} ${t.name}`;
    if (t.kind === 'drums') return `${head} · ${DRUM_SOUNDS[v.drumSound].name}`;
    if (t.kind === 'chords') return `${head} · pen ${chordName(v.pen)}`;
    if (t.kind === 'notes') return `${head} · pen ${degreeName(v.pen, t.octave)}`;
    return `${head} · empty`;
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
    description: 'The μcroOperator: PO-style groovebox, 16 tracks (drums, bass, chords, lead), 16 patterns, chains.',
    Component: MuOp,
};
