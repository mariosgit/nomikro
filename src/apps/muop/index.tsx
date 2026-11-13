// μOp: a small PO-style groovebox. 16 tracks (drums, bass, chords, lead, …), 16 patterns, chains. Played on the device.
import React, { useEffect, useReducer, useState } from 'react';
import type { Color } from '../../maschine';
import { audioContext, audioRunning } from '../../engine/audio';
import { useDeviceTask } from '../../shell/device';
import type { AppDef, AppProps } from '../../shell/types';
import { MuOpController, trackColor, type Cell, type MuOpView, type TrackView } from './controller';
import { HARMONY_MODES, KINDS, NOTE_NAMES, RATES, SCALES, STEPS, VOICINGS, kindName, loadSong, rateName, type HarmonyMode, type TrackKind } from './model';
import { midiOutputs, onMidiChange, requestMidi, type MidiPortInfo } from '../../engine/midi';
import { DRUM_SOUNDS, Sounds, soundsFor } from './sounds';
import { favoriteOf, indexIn, soundList } from './favorites';
import { FX } from './fx';
import { buttonLabel, type Help as HelpRow } from './page';

/** Pad numbers in screen order: top row first. Pad 0 = bottom left. */
const PADS_TOP_DOWN = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];

/** Cheat sheet, generated from the controller's pages (same data as the device lights / display). */
const CONTROLS = MuOpController.controls();

/** Cheat sheet rows that mention a button, e.g. 'REC' → "PLAY / STOP / REC", "REC + PERFORM + pad". */
function helpFor(button: string): HelpRow[] {
    const word = new RegExp(`(^|[^A-Z-])${buttonLabel(button as never).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z-]|$)`);
    return CONTROLS.filter((h) => word.test(h.keys));
}

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
                        <dt className="text-zinc-500 dark:text-zinc-400">Key</dt>
                        <dd>
                            <select value={v.root} onChange={(e) => ctl!.setKey({ root: Number(e.target.value) })} className={SELECT}>
                                {NOTE_NAMES.map((n, i) => (
                                    <option key={n} value={i} className="text-zinc-900">
                                        {n}
                                    </option>
                                ))}
                            </select>{' '}
                            <select value={v.scale} onChange={(e) => ctl!.setKey({ scale: e.target.value })} className={SELECT}>
                                {SCALES.map((sc) => (
                                    <option key={sc.id} value={sc.id} className="text-zinc-900">
                                        {sc.name}
                                    </option>
                                ))}
                            </select>
                        </dd>
                        <Stat k="Pattern" v={String(v.pattern + 1)} />
                        <Stat
                            k="Chain"
                            v={`${v.chain.map((p) => p + 1).join(' ')}${v.pendingChain ? ` → next ${v.pendingChain.map((p) => p + 1).join(' ')}` : ''}`}
                        />
                        <Stat k="Tempo" v={`${v.bpm} BPM · swing ${v.swing}% · master volume ${Math.round(v.volume * 100)}`} />
                        <Stat k="FX" v={v.fx.length ? v.fx.join(' · ') : '—'} />
                        <Stat k="Display" v={v.message.replace('\n', ' · ')} />
                        {v.held && <HeldHelp button={v.held} />}
                    </dl>
                ) : (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Connect the device to play.</p>
                )}
            </section>

            {v && ctl && <TrackList v={v} ctl={ctl} />}

            <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-2 font-semibold">Controls</h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    {CONTROLS.map((h) => (
                        <Help key={h.keys} k={h.keys} v={h.text} active={!!v?.held && helpFor(v.held).includes(h)} />
                    ))}
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

const SELECT = 'rounded-md border border-zinc-300 bg-transparent px-1.5 py-0.5 text-sm dark:border-zinc-700';
const TH = 'px-2 py-2 font-medium';
const TD = 'px-2 py-1';

function useMidiPorts(): MidiPortInfo[] {
    const [ports, setPorts] = useState(midiOutputs);
    useEffect(() => onMidiChange(() => setPorts(midiOutputs())), []);
    return ports;
}

/** The tracks in use with their settings (empty ones hidden, "+ track" enables the next). Name and MIDI out are only set here; the rest also on the device (SELECT page). */
function TrackList({ v, ctl }: { v: MuOpView; ctl: MuOpController }) {
    const ports = useMidiPorts();
    /** The next empty track (the "+" row enables it), -1 = all 16 in use. */
    const next = v.tracks.findIndex((t) => !t.kind);
    return (
        <section className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-sm">
                <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                    <tr className="border-b border-zinc-200 dark:border-zinc-800">
                        <th className="px-4 py-2 font-medium">#</th>
                        <th className={TH}>Name</th>
                        <th className={TH}>Kind</th>
                        <th className={TH}>Sound</th>
                        <th className={TH}>Octave</th>
                        <th className={TH}>Clock</th>
                        <th className={TH}>Length</th>
                        <th className={TH} title="Notes tracks: free / transpose / follow the first chords track. Chords tracks: voicing">
                            Harmony
                        </th>
                        <th className={`${TH} text-right`}>Volume</th>
                        <th className={`${TH} pr-4`}>MIDI out</th>
                    </tr>
                </thead>
                <tbody>
                    {v.tracks.map((t, i) => (t.kind ? <TrackRow key={i} i={i} t={t} selected={i === v.track} ctl={ctl} ports={ports} /> : null))}
                    {next >= 0 && (
                        <tr>
                            <td colSpan={10} className="px-4 py-1">
                                <button
                                    onClick={() => ctl.selectTrack(next)}
                                    title={`Add track ${next + 1}: a notes track with a random sound (like SELECT + an empty pad)`}
                                    className="rounded-md px-2 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                >
                                    + track
                                </button>
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </section>
    );
}

function TrackRow({ i, t, selected, ctl, ports }: { i: number; t: TrackView; selected: boolean; ctl: MuOpController; ports: MidiPortInfo[] }) {
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    const empty = !t.kind;
    const portMissing = t.midi && !ports.some((p) => p.id === t.midi!.port);
    return (
        <tr
            onClick={() => ctl.selectTrack(i)}
            className={`cursor-pointer border-b border-zinc-100 last:border-0 dark:border-zinc-800/60 ${
                selected ? 'bg-orange-50 dark:bg-orange-950/40' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
            } ${empty ? 'text-zinc-400 dark:text-zinc-500' : ''}`}
        >
            <td className="px-4 py-1 whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                <span className="mr-2 inline-block size-2 rounded-full" style={{ backgroundColor: CSS[trackColor(t)] }} />
                {i + 1}
            </td>
            <td className={TD} onClick={stop}>
                <NameInput value={t.name} onChange={(name) => ctl.setTrack(i, { name })} />
            </td>
            <td className={TD} onClick={stop}>
                <select value={t.kind ?? ''} onChange={(e) => ctl.setTrack(i, { kind: (e.target.value || null) as TrackKind | null })} className={SELECT}>
                    {KINDS.map((k) => (
                        <option key={k ?? ''} value={k ?? ''} className="text-zinc-900">
                            {kindName(k)}
                        </option>
                    ))}
                </select>
            </td>
            <td className={TD} onClick={stop}>
                {t.kind && !t.midi ? (
                    <SoundSelect i={i} t={t} kind={t.kind} ctl={ctl} />
                ) : (
                    <span className="text-xs text-zinc-400">{t.midi ? 'MIDI' : '–'}</span>
                )}
            </td>
            <td className={TD} onClick={stop}>
                {t.kind && t.kind !== 'drums' ? (
                    <select value={t.octave} onChange={(e) => ctl.setTrack(i, { octave: Number(e.target.value) })} className={SELECT}>
                        {[-3, -2, -1, 0, 1, 2, 3].map((o) => (
                            <option key={o} value={o} className="text-zinc-900">
                                {o > 0 ? `+${o}` : o}
                            </option>
                        ))}
                    </select>
                ) : (
                    <span className="text-xs text-zinc-400">–</span>
                )}
            </td>
            <td className={TD} onClick={stop}>
                <select value={t.rate} onChange={(e) => ctl.setTrack(i, { rate: Number(e.target.value) })} className={SELECT} disabled={empty}>
                    {RATES.map((r) => (
                        <option key={r} value={r} className="text-zinc-900">
                            {rateName(r)}
                        </option>
                    ))}
                </select>
            </td>
            <td className={TD} onClick={stop}>
                <select value={t.length} onChange={(e) => ctl.setTrack(i, { length: Number(e.target.value) })} className={SELECT} disabled={empty}>
                    {Array.from({ length: STEPS }, (_, n) => n + 1).map((n) => (
                        <option key={n} value={n} className="text-zinc-900">
                            {n}
                        </option>
                    ))}
                </select>
            </td>
            <td className={TD} onClick={stop}>
                {t.kind === 'notes' ? (
                    <select value={t.harmony} onChange={(e) => ctl.setTrack(i, { harmony: e.target.value as HarmonyMode })} className={SELECT}>
                        {HARMONY_MODES.map((h) => (
                            <option key={h} value={h} className="text-zinc-900">
                                {h}
                            </option>
                        ))}
                    </select>
                ) : t.kind === 'chords' ? (
                    <select value={t.voicing} onChange={(e) => ctl.setTrack(i, { voicing: Number(e.target.value) })} className={SELECT}>
                        {VOICINGS.map((name, n) => (
                            <option key={name} value={n} className="text-zinc-900">
                                {name}
                            </option>
                        ))}
                    </select>
                ) : (
                    <span className="text-xs text-zinc-400">–</span>
                )}
            </td>
            <td className={`${TD} text-right tabular-nums`}>{empty ? '' : Math.round(t.level * 100)}</td>
            <td className={`${TD} pr-4 whitespace-nowrap`} onClick={stop}>
                <select
                    value={t.midi?.port ?? ''}
                    onPointerDown={() => void requestMidi()}
                    onFocus={() => void requestMidi()}
                    onChange={(e) => {
                        const port = ports.find((p) => p.id === e.target.value);
                        ctl.setTrack(i, { midi: port ? { port: port.id, name: port.name, channel: t.midi?.channel ?? 1 } : null });
                    }}
                    className={`${SELECT} max-w-40`}
                    disabled={empty}
                >
                    <option value="" className="text-zinc-900">
                        internal
                    </option>
                    {portMissing && (
                        <option value={t.midi!.port} className="text-zinc-900">
                            {t.midi!.name} (not connected)
                        </option>
                    )}
                    {ports.map((p) => (
                        <option key={p.id} value={p.id} className="text-zinc-900">
                            {p.name}
                        </option>
                    ))}
                </select>
                {t.midi && (
                    <select
                        value={t.midi.channel}
                        onChange={(e) => ctl.setTrack(i, { midi: { ...t.midi!, channel: Number(e.target.value) } })}
                        className={`${SELECT} ml-1`}
                        title="MIDI channel"
                    >
                        {Array.from({ length: 16 }, (_, n) => n + 1).map((n) => (
                            <option key={n} value={n} className="text-zinc-900">
                                ch {n}
                            </option>
                        ))}
                    </select>
                )}
            </td>
        </tr>
    );
}

/** Local text while typing (the view updates a frame later), committed on every change. */
function NameInput({ value, onChange }: { value: string; onChange(name: string): void }) {
    const [text, setText] = useState(value);
    const [editing, setEditing] = useState(false);
    return (
        <input
            value={editing ? text : value}
            onFocus={() => {
                setText(value);
                setEditing(true);
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => {
                setText(e.target.value);
                onChange(e.target.value);
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="w-28 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-medium hover:border-zinc-300 focus:border-zinc-400 dark:hover:border-zinc-700"
        />
    );
}

/** The sound browser (instruments, the edited sound, favorites ★), plus save / delete favorite. */
function SoundSelect({ i, t, kind, ctl }: { i: number; t: TrackView; kind: TrackKind; ctl: MuOpController }) {
    const list = soundList(kind, { sound: t.sound, params: t.params });
    const current = indexIn(kind, list, t.sound, t.params);
    const fav = favoriteOf(kind, t.sound, t.params);
    const engine = (id: string) => soundsFor(kind).find((d) => d.id === id)?.engine ?? '';
    return (
        <span className="inline-flex items-center gap-1">
            <select
                value={current}
                onChange={(e) => {
                    const entry = list[Number(e.target.value)];
                    if (entry) void ctl.setSound(i, entry.sound, false, entry.params);
                }}
                className={SELECT}
            >
                {list.map((e, k) => (
                    <option key={k} value={k} className="text-zinc-900">
                        {e.favorite === undefined ? `${e.name} (${engine(e.sound)})` : e.name}
                    </option>
                ))}
            </select>
            {fav >= 0 ? (
                <button
                    onClick={() => ctl.deleteFavorite(fav)}
                    title="Delete this favorite (the track keeps the sound)"
                    className="rounded px-1 text-orange-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                    ★×
                </button>
            ) : (
                <button
                    onClick={() => ctl.saveFavorite(i)}
                    title="Save this sound as a favorite (STAR on the device)"
                    className="rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-orange-500 dark:hover:bg-zinc-800"
                >
                    ☆
                </button>
            )}
        </span>
    );
}

/** "Bass · pen A1" / "Drums · Kick" / "Chords · pen Am" */
function trackSummary(v: MuOpView): string {
    const t = v.tracks[v.track];
    const head = `${v.track + 1} ${t.name}`;
    if (t.kind === 'drums') return `${head} · ${DRUM_SOUNDS[v.drumSound].name}`;
    if (t.kind === 'chords' || t.kind === 'notes') return `${head} · pen ${v.penName}`;
    return `${head} · empty`;
}

const Stat = ({ k, v }: { k: string; v: string }) => (
    <>
        <dt className="text-zinc-500 dark:text-zinc-400">{k}</dt>
        <dd className="font-medium">{v}</dd>
    </>
);

const Help = ({ k, v, active = false }: { k: string; v: string; active?: boolean }) => (
    <>
        <dt className={`font-mono text-xs whitespace-nowrap ${active ? 'font-semibold text-orange-600 dark:text-orange-400' : 'text-zinc-500 dark:text-zinc-400'}`}>{k}</dt>
        <dd className={active ? 'font-medium text-orange-700 dark:text-orange-300' : undefined}>{v}</dd>
    </>
);

/** The help for the button held on the device (top panel, so it's visible without scrolling). */
function HeldHelp({ button }: { button: string }) {
    const rows = helpFor(button);
    return (
        <div className="col-span-2 mt-3 rounded-lg bg-orange-50 p-3 dark:bg-orange-950/40">
            <div className="mb-1 text-xs font-medium text-orange-700 dark:text-orange-300">Holding {buttonLabel(button as never)}</div>
            {rows.length ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    {rows.map((h) => (
                        <Help key={h.keys} k={h.keys} v={h.text} />
                    ))}
                </dl>
            ) : (
                <p className="text-zinc-500 dark:text-zinc-400">Nothing mapped on this button yet.</p>
            )}
        </div>
    );
}

export const muop: AppDef = {
    label: 'μOp',
    title: 'μOp - The μcroOperator',
    description: 'The μcroOperator: PO-style groovebox, 16 tracks (drums, bass, chords, lead), 16 patterns, chains.',
    Component: MuOp,
};
