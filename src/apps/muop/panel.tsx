// μOp app page: the panel right of the pads. Tabs Mixer / Sound / Info; holding a button on the device switches it:
// PERFORM → FX table, PLUG-IN → sound editor, any other button → its help. Release = back to the chosen tab.
import React, { useEffect, useRef, useState } from 'react';
import type { Color } from '../../maschine';
import { DRIVE, DRUM_ROLES, clampParam, findInstrument, formatParam, type ParamDef } from '../../engine/instruments';
import { TAP_MS, buttonLabel } from './page';
import type { MuOpController, MuOpView, TrackView } from './controller';
import { trackColor } from './controller';
import { DRUM_SOUNDS, soundsFor } from './sounds';
import { FX } from './fx';
import type { InputStatus } from './inputs';

export const CSS: Record<Color, string> = {
    off: 'transparent', red: '#ef4444', orange: '#f97316', orange_light: '#fdba74', yellow_warm: '#fbbf24', yellow: '#facc15',
    lime: '#a3e635', green: '#22c55e', mint: '#6ee7b7', cyan: '#22d3ee', turquoise: '#2dd4bf', blue: '#3b82f6', plum: '#c084fc',
    violet: '#8b5cf6', purple: '#a855f7', magenta: '#d946ef', fuchsia: '#ec4899', white: '#f4f4f5',
};

/** Pad numbers in screen order: top row first. Pad 0 = bottom left. */
export const PADS_TOP_DOWN = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];

const METER_DB = 48;
/** 0..1 for a level (dB scale, -48 dB … 0 dB). */
export const meterX = (level: number) => Math.max(0, Math.min(1, 1 + (20 * Math.log10(Math.max(level, 1e-6))) / METER_DB));

/** The held button once it's held longer than a tap (short presses don't flash the help up). */
export function useLongHeld<T extends string>(held: T | null): T | null {
    const [long, setLong] = useState<T | null>(null);
    useEffect(() => {
        if (!held) return setLong(null);
        const timer = setTimeout(() => setLong(held), TAP_MS);
        return () => clearTimeout(timer);
    }, [held]);
    return held && long === held ? held : null;
}

type Tab = 'mixer' | 'sound' | 'inputs' | 'info';
const TABS: { id: Tab; name: string }[] = [
    { id: 'mixer', name: 'Mixer' },
    { id: 'sound', name: 'Sound' },
    { id: 'inputs', name: 'Inputs' },
    { id: 'info', name: 'Info' },
];

export interface PanelProps {
    v: MuOpView;
    ctl: MuOpController;
    /** The track's sound browser select (from the track list). */
    SoundSelect: React.ComponentType<{ i: number; t: TrackView; kind: NonNullable<TrackView['kind']>; ctl: MuOpController }>;
    /** The pad grid: left of the panel content, below the tab line. */
    pads: React.ReactNode;
    /** Help for the held button. */
    help: React.ReactNode;
    info: React.ReactNode;
}

export function Panel({ v, ctl, pads, SoundSelect, help, info }: PanelProps) {
    const [tab, setTab] = useState<Tab>('mixer');
    const held = useLongHeld(v.held);
    const auto = held === 'perform' ? 'fx' : held === 'plug_in' ? 'sound' : held ? 'help' : null;
    const shown = auto ?? tab;
    // grid: tab line on top right, below it the pads (left) and the content (right), tops aligned
    return (
        <div className="grid grid-cols-1 gap-x-6 md:grid-cols-[auto_1fr]">
            <div className="hidden md:block" />
            <div className="mb-3 flex items-center justify-end gap-1 border-b border-zinc-200 text-sm dark:border-zinc-800">
                {held && (
                    <span className="mr-auto rounded bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950/60 dark:text-orange-300">
                        holding {buttonLabel(held)}
                    </span>
                )}
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`-mb-px border-b-2 px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${
                            shown === t.id ? 'border-orange-500 font-medium' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
                        }`}
                    >
                        {t.name}
                    </button>
                ))}
            </div>
            <div className="mb-4 md:mb-0">{pads}</div>
            <div className="min-w-0">
                {shown === 'mixer' && <Mixer v={v} ctl={ctl} />}
                {shown === 'sound' && <SoundEditor v={v} ctl={ctl} SoundSelect={SoundSelect} />}
                {shown === 'inputs' && <InputsSetup ctl={ctl} />}
                {shown === 'info' && info}
                {shown === 'help' && help}
                {shown === 'fx' && <FxTable />}
            </div>
        </div>
    );
}

// --- Mixer ---

/** Strips for the tracks in use + master. Meters update per animation frame straight in the DOM. */
function Mixer({ v, ctl }: { v: MuOpView; ctl: MuOpController }) {
    const used = v.tracks.flatMap((t, i) => (t.kind ? [i] : []));
    const ins = ctl.inputs.settings;
    const bars = useRef(new Map<number, HTMLDivElement>());
    useEffect(() => {
        let raf = 0;
        const frame = () => {
            for (const [track, el] of bars.current) {
                const m = track === -1 ? ctl.meter() : track === -2 ? ctl.inputsMeter() : ctl.trackMeter(track);
                el.style.height = `${meterX(m.peak) * 100}%`;
            }
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [ctl]);
    const meterRef = (track: number) => (el: HTMLDivElement | null) => {
        if (el) bars.current.set(track, el);
        else bars.current.delete(track);
    };

    // right aligned (ml-auto on the inner row keeps it scrollable when it gets wider than the panel)
    return (
        <div className="flex overflow-x-auto pb-1">
            <div className="ml-auto flex gap-1.5">
            {used.map((i) => {
                const t = v.tracks[i];
                const selected = i === v.track;
                // MIDI out: the sound comes from the synth (Inputs strip), level / meter / Drive don't apply
                const midi = !!t.midi;
                const off = midi ? 'pointer-events-none opacity-25' : '';
                return (
                    <div
                        key={i}
                        className={`flex w-16 shrink-0 flex-col items-center gap-1.5 rounded-lg p-1.5 text-xs ${
                            selected ? 'bg-orange-50 dark:bg-orange-950/40' : 'bg-zinc-50 dark:bg-zinc-800/40'
                        } ${t.audible ? '' : 'opacity-50'}`}
                    >
                        <button onClick={() => ctl.selectTrack(i)} className="flex w-full items-center gap-1 truncate text-left font-medium" title={`T${i + 1} ${t.name}: select`}>
                            <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: CSS[trackColor(t)] }} />
                            <span className="truncate">{t.name}</span>
                        </button>
                        <div className={`flex h-32 items-stretch gap-1 ${off}`} title={midi ? 'MIDI out: the level is set on the synth / the Inputs strip' : undefined}>
                            <Fader value={t.level} max={1.5} onChange={(level) => ctl.setTrack(i, { level })} title={`Volume ${Math.round(t.level * 100)}`} />
                            <MeterBar ref={meterRef(i)} />
                        </div>
                        <span className={`text-zinc-500 tabular-nums dark:text-zinc-400 ${off}`}>{Math.round(t.level * 100)}</span>
                        <div className="flex gap-1">
                            <Toggle on={t.mute} onClick={() => ctl.setTrack(i, { mute: !t.mute })} color="bg-zinc-600 text-white" title="Mute: the sequencer skips the track (sound and MIDI)">
                                M
                            </Toggle>
                            <Toggle on={t.solo} onClick={() => ctl.setTrack(i, { solo: !t.solo })} color="bg-yellow-400 text-zinc-900" title="Solo: only solo tracks play">
                                S
                            </Toggle>
                        </div>
                        <label className={`flex w-full flex-col items-center ${off}`} title="Drive (distortion) on the whole track">
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={t.params.drive ?? 0}
                                onChange={(e) => ctl.setParam(i, DRIVE, Number(e.target.value))}
                                className="w-full accent-orange-500"
                            />
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">drive {Math.round((t.params.drive ?? 0) * 100)}</span>
                        </label>
                        <span
                            className={`text-[10px] ${midi ? 'font-medium text-orange-600 dark:text-orange-400' : 'text-zinc-500 dark:text-zinc-400'}`}
                            title={midi ? 'MIDI out (track list below): mute / solo work, the sound comes back via Inputs' : 'Internal sound (MIDI out: track list below)'}
                        >
                            {t.midi ? `MIDI ch ${t.midi.channel + 1}` : 'internal'}
                        </span>
                    </div>
                );
            })}
            {ins.inputs.length > 0 && (
                <div className={`flex w-16 shrink-0 flex-col items-center gap-1.5 rounded-lg bg-zinc-50 p-1.5 text-xs dark:bg-zinc-800/40 ${ins.mute ? 'opacity-50' : ''}`}>
                    <span className="font-medium" title="All audio inputs together (set them up on the Inputs tab)">
                        Inputs
                    </span>
                    <div className="flex h-32 items-stretch gap-1">
                        <Fader value={ins.level} max={1.5} onChange={(level) => ctl.inputs.setBus({ level })} title={`Inputs ${Math.round(ins.level * 100)}`} />
                        <MeterBar ref={meterRef(-2)} />
                    </div>
                    <span className="text-zinc-500 tabular-nums dark:text-zinc-400">{Math.round(ins.level * 100)}</span>
                    <Toggle on={ins.mute} onClick={() => ctl.inputs.setBus({ mute: !ins.mute })} color="bg-zinc-600 text-white" title="Mute all inputs">
                        M
                    </Toggle>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {ins.inputs.length} {ins.inputs.length === 1 ? 'input' : 'inputs'}
                    </span>
                </div>
            )}
            <div className="flex w-16 shrink-0 flex-col items-center gap-1.5 rounded-lg bg-zinc-100 p-1.5 text-xs dark:bg-zinc-800">
                <span className="font-medium">Master</span>
                <div className="flex h-32 items-stretch gap-1">
                    <Fader value={v.volume} max={1} onChange={(vol) => ctl.setVolume(vol)} title={`Master volume ${Math.round(v.volume * 100)}`} />
                    <MeterBar ref={meterRef(-1)} />
                </div>
                <span className="text-zinc-500 tabular-nums dark:text-zinc-400">{Math.round(v.volume * 100)}</span>
            </div>
            </div>
        </div>
    );
}

function Fader({ value, max, onChange, title }: { value: number; max: number; onChange(v: number): void; title: string }) {
    return (
        <input
            type="range"
            min={0}
            max={max}
            step={0.01}
            value={value}
            title={title}
            onChange={(e) => onChange(Number(e.target.value))}
            onDoubleClick={() => onChange(1)}
            className="h-full w-4 accent-orange-500"
            style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
        />
    );
}

/** Vertical meter: green, yellow from about -6 dB, red at the top (the fill shows its part of the scale). */
const MeterBar = React.forwardRef<HTMLDivElement>(function MeterBar(_, ref) {
    return (
        <div className="relative w-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div
                ref={ref}
                className="absolute inset-x-0 bottom-0"
                style={{ height: 0, backgroundImage: 'linear-gradient(to top, #22c55e 80%, #facc15 88%, #ef4444 98%)', backgroundSize: '100% 8rem', backgroundPosition: 'bottom' }}
            />
        </div>
    );
});

function Toggle({ on, onClick, color, title, children }: { on: boolean; onClick(): void; color: string; title: string; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            title={title}
            className={`size-6 rounded text-xs font-bold ${on ? color : 'bg-zinc-200 text-zinc-500 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-600'}`}
        >
            {children}
        </button>
    );
}

// --- Inputs ---

const STATUS: Record<InputStatus, { text: string; color: string }> = {
    off: { text: 'choose a device', color: 'text-zinc-500' },
    opening: { text: 'opening…', color: 'text-zinc-500' },
    on: { text: 'on', color: 'text-green-600 dark:text-green-400' },
    missing: { text: 'not connected', color: 'text-orange-500' },
    denied: { text: 'no permission', color: 'text-red-500' },
    error: { text: 'failed', color: 'text-red-500' },
};

/** Audio inputs of this computer (USB audio of external synths): device, level, mute, meter. */
function InputsSetup({ ctl }: { ctl: MuOpController }) {
    const ins = ctl.inputs;
    const bars = useRef(new Map<string, HTMLDivElement>());
    useEffect(() => {
        let raf = 0;
        const frame = () => {
            for (const [id, el] of bars.current) el.style.width = `${meterX(ins.meter(id)) * 100}%`;
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [ins]);

    return (
        <div className="space-y-3 text-sm">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Audio from your synths (USB audio) into the mix: through the strip filter, the PERFORM mix FX and the master. Saved on this computer, not in the
                song. The first input asks for the microphone permission (macOS: also allow the browser in System Settings → Privacy → Microphone).
            </p>
            {ins.settings.inputs.map((input, n) => {
                const { status, error } = ins.status(input.id);
                const known = ins.devices.some((d) => d.id === input.deviceId);
                return (
                    <div key={input.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/40">
                        <select value={input.deviceId} onChange={(e) => ins.update(input.id, { deviceId: e.target.value })} className={`${SELECT} max-w-56`}>
                            {!input.deviceId && (
                                <option value="" className="text-zinc-900">
                                    choose…
                                </option>
                            )}
                            {input.deviceId && !known && (
                                <option value={input.deviceId} className="text-zinc-900">
                                    {input.label || 'unknown device'} (not connected)
                                </option>
                            )}
                            {ins.devices.map((d, k) => (
                                <option key={d.id} value={d.id} className="text-zinc-900">
                                    {d.label || `Input ${k + 1}`}
                                </option>
                            ))}
                        </select>
                        <span className={`text-xs ${STATUS[status].color}`} title={error}>
                            {STATUS[status].text}
                        </span>
                        {(status === 'denied' || status === 'error' || status === 'missing') && (
                            <button onClick={() => ins.retry(input.id)} className={BUTTON}>
                                retry
                            </button>
                        )}
                        <span className="ml-auto flex items-center gap-2">
                            <span className="relative h-2 w-28 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                                <div
                                    ref={(el) => {
                                        if (el) bars.current.set(input.id, el);
                                        else bars.current.delete(input.id);
                                    }}
                                    className="absolute inset-y-0 left-0"
                                    style={{ width: 0, backgroundImage: 'linear-gradient(to right, #22c55e 80%, #facc15 88%, #ef4444 98%)', backgroundSize: '7rem 100%' }}
                                />
                            </span>
                            <input
                                type="range"
                                min={0}
                                max={2}
                                step={0.01}
                                value={input.level}
                                onChange={(e) => ins.update(input.id, { level: Number(e.target.value) })}
                                onDoubleClick={() => ins.update(input.id, { level: 1 })}
                                className="w-24 accent-orange-500"
                                title={`Level ${Math.round(input.level * 100)} (double click: 100)`}
                            />
                            <span className="w-8 text-right text-xs tabular-nums">{Math.round(input.level * 100)}</span>
                            <Toggle on={input.mute} onClick={() => ins.update(input.id, { mute: !input.mute })} color="bg-zinc-600 text-white" title="Mute this input">
                                M
                            </Toggle>
                            <button onClick={() => ins.remove(input.id)} className={BUTTON} title={`Remove input ${n + 1}`}>
                                ×
                            </button>
                        </span>
                    </div>
                );
            })}
            <div className="flex items-center gap-2">
                <button onClick={() => void ins.add()} className={BUTTON}>
                    + input
                </button>
                {ins.addError && <span className="text-xs text-red-500">{ins.addError}</span>}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                The input adds about 10–30 ms of latency (USB + buffer): a synth played via MIDI out sounds a little late. Compensation comes later.
            </p>
        </div>
    );
}

// --- Sound editor ---

/** Slider position 0..1 ↔ value (log params spread logarithmically). */
const toPos = (def: ParamDef, v: number) => (def.log && def.min > 0 ? Math.log(v / def.min) / Math.log(def.max / def.min) : (v - def.min) / (def.max - def.min));
const fromPos = (def: ParamDef, p: number) => clampParam(def, def.log && def.min > 0 ? def.min * Math.pow(def.max / def.min, p) : def.min + p * (def.max - def.min));

/** The selected track's sound: browser, parameters as sliders (drums: per drum sound), randomize / A/B. */
function SoundEditor({ v, ctl, SoundSelect }: { v: MuOpView; ctl: MuOpController; SoundSelect: PanelProps['SoundSelect'] }) {
    const i = v.track;
    const t = v.tracks[i];
    if (!t.kind) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Empty track: select or add one.</p>;
    const defs = findInstrument(soundsFor(t.kind), t.sound).params;
    const drums = t.kind === 'drums';
    const shown = drums ? defs.filter((d) => d.id.startsWith(`${v.drumSound}.`)) : defs;
    return (
        <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                    T{i + 1} {t.name}
                </span>
                {t.midi ? <span className="text-xs text-zinc-500">MIDI out: the internal sound is not used</span> : <SoundSelect i={i} t={t} kind={t.kind} ctl={ctl} />}
                <span className="ml-auto flex gap-1">
                    <button onClick={() => ctl.randomize(i)} className={BUTTON} title="Random values for the parameters shown (PLUG-IN + encoder push)">
                        Randomize
                    </button>
                    <button onClick={() => ctl.revert(i)} className={BUTTON} title="Back to before the last randomize, again = forward (PLUG-IN short press)">
                        A/B
                    </button>
                </span>
            </div>
            {drums && (
                <div className="flex flex-wrap gap-1">
                    {DRUM_ROLES.map((role, d) => (
                        <button
                            key={role}
                            onClick={() => ctl.selectDrumSound(d)}
                            className={`rounded border-l-4 px-2 py-0.5 text-xs ${d === v.drumSound ? 'bg-zinc-200 font-medium dark:bg-zinc-700' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}
                            style={{ borderColor: CSS[DRUM_SOUNDS[d].color] }}
                        >
                            {role}
                        </button>
                    ))}
                </div>
            )}
            <div className="grid grid-cols-[auto_1fr_5rem] items-center gap-x-3 gap-y-1.5">
                {shown.map((def) => {
                    const value = clampParam(def, t.params[def.id] ?? def.default);
                    return (
                        <React.Fragment key={def.id}>
                            <span className="text-zinc-500 dark:text-zinc-400" onDoubleClick={() => ctl.setParam(i, def, def.default)} title="Double click: default">
                                {def.name}
                            </span>
                            {def.options ? (
                                <select value={value} onChange={(e) => ctl.setParam(i, def, Number(e.target.value))} className={SELECT}>
                                    {def.options.map((o, k) => (
                                        <option key={o} value={k} className="text-zinc-900">
                                            {o}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={def.int ? 1 / (def.max - def.min) : 0.001}
                                    value={toPos(def, value)}
                                    onChange={(e) => ctl.setParam(i, def, fromPos(def, Number(e.target.value)))}
                                    onDoubleClick={() => ctl.setParam(i, def, def.default)}
                                    className="accent-orange-500"
                                />
                            )}
                            <span className="text-right tabular-nums">{formatParam(def, value)}</span>
                        </React.Fragment>
                    );
                })}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Same as holding PLUG-IN on the device. Double click a slider = default. ☆ next to the sound saves a favorite.
            </p>
        </div>
    );
}

// --- FX ---

/** PERFORM pads as on the device, with what they do. */
export function FxTable() {
    return (
        <div className="space-y-2">
            <div className="grid max-w-md grid-cols-4 gap-1.5">
                {PADS_TOP_DOWN.map((pad) => (
                    <div key={pad} className="rounded-md border-l-4 bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800" style={{ borderColor: CSS[FX[pad].color] }}>
                        <span className="text-zinc-500 dark:text-zinc-400">{pad + 1}</span> {FX[pad].name}
                    </div>
                ))}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                1–8 selected track: loops repeat the last 1/2/4/8 steps, retrig repeats the step 2×/3×, reverse plays backwards, half time stretches. 9–16 mix:
                filter sweeps over a bar, gate chops 1/16, pump ducks every beat, echo is dotted 1/8, slow down = tape stop. With REC on while playing they are
                recorded into the pattern.
            </p>
        </div>
    );
}

const SELECT = 'rounded-md border border-zinc-300 bg-transparent px-1.5 py-0.5 text-sm dark:border-zinc-700';
const BUTTON = 'rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800';
