// μOp: a small PO-style groovebox. 16 tracks (drums, bass, chords, lead, …), 16 patterns, chains. Played on the device.
import React, { useEffect, useReducer, useRef, useState } from 'react';
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
import { CSS, FxTable, PADS_TOP_DOWN, Panel, meterX, useLongHeld } from './panel';

/** Cheat sheet, generated from the controller's pages (same data as the device lights / display). */
const CONTROLS = MuOpController.controls();

/** Cheat sheet rows that mention a button, e.g. 'REC' → "PLAY / STOP / REC", "REC + PERFORM + pad". */
function helpFor(button: string): HelpRow[] {
    const word = new RegExp(`(^|[^A-Z-])${buttonLabel(button as never).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z-]|$)`);
    return CONTROLS.filter((h) => word.test(h.keys));
}

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
    const held = useLongHeld(v?.held ?? null);
    const pads = (
        <div className="grid w-64 shrink-0 grid-cols-4 gap-2 self-start">
            {PADS_TOP_DOWN.map((n) => (
                <PadCell key={n} cell={v?.cells[n]} label={n + 1} text={v?.labels[n] ?? ''} />
            ))}
        </div>
    );
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

            {v && ctl && <StatusBar v={v} ctl={ctl} />}

            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                {v && ctl ? (
                    <Panel
                        v={v}
                        ctl={ctl}
                        pads={pads}
                        SoundSelect={SoundSelect}
                        help={v.held ? <HeldHelp button={v.held} /> : null}
                        info={
                    <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 text-sm">
                        <Stat k="Track" v={trackSummary(v)} />
                        <Stat k="Pads" v={v.stepMode ? 'Steps (STEP)' : 'Play'} />
                        <Stat k="Pattern" v={String(v.pattern + 1)} />
                        <Stat
                            k="Chain"
                            v={`${v.chain.map((p) => p + 1).join(' ')}${v.pendingChain ? ` → next ${v.pendingChain.map((p) => p + 1).join(' ')}` : ''}`}
                        />
                        <Stat k="FX" v={v.fx.length ? v.fx.join(' · ') : '—'} />
                        <Stat k="Display" v={v.message.replace('\n', ' · ')} />
                    </dl>
                        }
                    />
                ) : (
                    <div className="flex flex-wrap gap-6">
                        {pads}
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Connect the device to play.</p>
                    </div>
                )}
            </section>

            {v && ctl && <TrackList v={v} ctl={ctl} />}

            <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-2 font-semibold">Controls</h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    {CONTROLS.map((h) => (
                        <Help key={h.keys} k={h.keys} v={h.text} active={!!held && helpFor(held).includes(h)} />
                    ))}
                </dl>
                <h3 className="mt-4 mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">PERFORM pads (as on the device)</h3>
                <FxTable />
            </section>
        </div>
    );
}

/** Top bar: transport, tempo, key, position, cycle, master level. */
function StatusBar({ v, ctl }: { v: MuOpView; ctl: MuOpController }) {
    const bars = v.cycle / STEPS;
    const tick = v.tick;
    return (
        <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-zinc-200 bg-white px-5 py-2.5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <span className="font-medium tabular-nums">
                {v.playing ? <span className="text-green-600 dark:text-green-400">▶</span> : <span className="text-zinc-400">■</span>}
                {v.recording && <span className="ml-1.5 text-red-500">● rec</span>}
                {v.metronome && <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">metro</span>}
            </span>
            <span className="tabular-nums" title="Song position: pattern · bar.beat since play">
                P{v.pattern + 1} · {tick >= 0 ? `${Math.floor(tick / STEPS) + 1}.${Math.floor((tick % STEPS) / 4) + 1}` : '–'}
            </span>
            <span
                className="text-zinc-500 tabular-nums dark:text-zinc-400"
                title="All tracks (lengths, clocks) line up again after this many bars (polymeter cycle)"
            >
                cycle {tick >= 0 ? Math.floor((tick % v.cycle) / STEPS) + 1 : '–'} / {bars} {bars === 1 ? 'bar' : 'bars'}
            </span>
            <span className="tabular-nums">
                {v.bpm} BPM <span className="text-zinc-500 dark:text-zinc-400">· swing {v.swing}%</span>
            </span>
            <span className="inline-flex items-center gap-1">
                <span className="text-zinc-500 dark:text-zinc-400">Key</span>
                <select value={v.root} onChange={(e) => ctl.setKey({ root: Number(e.target.value) })} className={SELECT}>
                    {NOTE_NAMES.map((n, i) => (
                        <option key={n} value={i} className="text-zinc-900">
                            {n}
                        </option>
                    ))}
                </select>
                <select value={v.scale} onChange={(e) => ctl.setKey({ scale: e.target.value })} className={SELECT}>
                    {SCALES.map((sc) => (
                        <option key={sc.id} value={sc.id} className="text-zinc-900">
                            {sc.name}
                        </option>
                    ))}
                </select>
            </span>
            <Meter ctl={ctl} volume={v.volume} />
        </section>
    );
}

const OVER_CLASS = 'rounded px-1.5 text-xs font-bold';

/**
 * Master level: bar (green → yellow → red), falling peak marker, "OVER" in red after clipping (crackles).
 * Updated per animation frame straight in the DOM (no React render per frame).
 */
function Meter({ ctl, volume }: { ctl: MuOpController; volume: number }) {
    const bar = useRef<HTMLDivElement>(null);
    const hold = useRef<HTMLDivElement>(null);
    const over = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        let raf = 0;
        const frame = () => {
            const m = ctl.meter();
            if (bar.current) bar.current.style.width = `${meterX(m.peak) * 100}%`;
            if (hold.current) hold.current.style.left = `calc(${meterX(m.hold) * 100}% - 1px)`;
            if (over.current) over.current.className = `${OVER_CLASS} ${m.over ? 'bg-red-500 text-white' : 'bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'}`;
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [ctl]);
    return (
        <span className="ml-auto inline-flex items-center gap-2" title={`Master level (−48 … 0 dB). OVER = clipping: lower the volume / Drive`}>
            <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">vol {Math.round(volume * 100)}</span>
            <span className="relative h-2.5 w-40 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                {/* the color scale spans the whole meter (green, yellow from -6 dB, red at the top), the fill shows its part */}
                <div
                    ref={bar}
                    className="absolute inset-y-0 left-0"
                    style={{ width: 0, backgroundImage: 'linear-gradient(to right, #22c55e 80%, #facc15 88%, #ef4444 98%)', backgroundSize: '10rem 100%' }}
                />
                <div ref={hold} className="absolute inset-y-0 w-0.5 bg-zinc-700 dark:bg-zinc-200" style={{ left: 0 }} />
            </span>
            <span ref={over} className={`${OVER_CLASS} bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500`}>
                OVER
            </span>
        </span>
    );
}

function PadCell({ cell, label, text }: { cell: Cell | undefined; label: number; text: string }) {
    const color = cell && cell.level > 0 ? CSS[cell.color] : undefined;
    return (
        <div
            className="relative aspect-square rounded-md bg-zinc-200 dark:bg-zinc-800"
            style={color ? { backgroundColor: color, opacity: 0.35 + 0.65 * (cell!.level / 3) } : undefined}
        >
            <span className="absolute top-0.5 left-1 text-[10px] text-zinc-500 mix-blend-difference">{label}</span>
            {text && (
                <span className="absolute inset-x-0.5 bottom-0.5 truncate text-center text-[10px] leading-tight font-medium text-zinc-900 dark:text-zinc-100" title={text}>
                    {text}
                </span>
            )}
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
