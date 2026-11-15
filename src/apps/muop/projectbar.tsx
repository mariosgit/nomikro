// Project bar above the pads: pick / new / duplicate / rename / delete, export as a text to copy, import a pasted text.
import React, { useEffect, useRef, useState } from 'react';
import { createProject, deleteProject, duplicateProject, exportProject, importProject, loadProject, projects, renameProject } from './projects';
import type { Song } from './model';
import { midiPlan, midiSequence, midiTracks, songToMidi, MAX_PASSES, type MidiOptions, type MidiRepeat } from './midifile';

const MIDI_OPTIONS_KEY = 'muop/midi-export';
const DEFAULT_MIDI: MidiOptions = { source: 'chain', repeat: 1 };

/** The last used MIDI export options (this browser). */
function loadMidiOptions(): MidiOptions {
    try {
        const o = JSON.parse(localStorage.getItem(MIDI_OPTIONS_KEY) ?? 'null') as Partial<MidiOptions> | null;
        return {
            source: o?.source === 'all' ? 'all' : 'chain',
            repeat: ([1, 2, 4, 8, 'align'] as const).find((r) => r === o?.repeat) ?? 1,
        };
    } catch {
        return DEFAULT_MIDI;
    }
}

function saveMidiOptions(o: MidiOptions): void {
    try {
        localStorage.setItem(MIDI_OPTIONS_KEY, JSON.stringify({ source: o.source, repeat: o.repeat })); // tracks: per project, not kept
    } catch {
        // blocked storage: the options just aren't remembered
    }
}

/** Saves the project as a .mid file (browser download). */
function downloadMidi(song: Song, name: string, options: MidiOptions): void {
    const blob = new Blob([songToMidi(song, name, options) as Uint8Array<ArrayBuffer>], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'song'}.mid`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One segmented choice (radio-like buttons). */
function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void }) {
    return (
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700" role="radiogroup">
            {options.map((o) => (
                <button
                    key={String(o.value)}
                    type="button"
                    role="radio"
                    aria-checked={o.value === value}
                    title={o.title}
                    onClick={() => onChange(o.value)}
                    className={
                        o.value === value
                            ? 'bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : 'px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
                    }
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

type Mode = { kind: 'none' } | { kind: 'midi' } | { kind: 'rename'; name: string } | { kind: 'delete' } | { kind: 'export'; text: string; copied: boolean } | { kind: 'import'; text: string };

const BTN =
    'rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';
const ICON_BTN =
    'grid size-7 place-items-center rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';
const ICON_BTN_ON = 'grid size-7 place-items-center rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900';

/** 24×24 stroke icons (currentColor). */
const ICONS = {
    plus: 'M12 5v14M5 12h14',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    upload: 'M12 15V4M7 9l5-5 5 5M5 15v5h14v-5',
    download: 'M12 4v11M7 10l5 5 5-5M5 15v5h14v-5',
    clipboard: 'M9 4h6v3H9zM8 5H5v16h14V5h-3',
    check: 'M5 12l5 5 9-10',
    chevron: 'M7 10l5 5 5-5',
    midi: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
    return (
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={ICONS[name]} />
        </svg>
    );
}

/** Icon button with a tooltip (title) and an accessible name. */
function IconButton({ icon, label, on, ...rest }: { icon: keyof typeof ICONS; label: string; on?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button className={on ? ICON_BTN_ON : ICON_BTN} title={label} aria-label={label} aria-pressed={on} {...rest}>
            <Icon name={icon} />
        </button>
    );
}
const BTN_RED = 'rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700';
const FIELD =
    'w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200';

/** `song`: the live song while the device task runs (the MIDI options follow edits on the device), else the stored one. */
export function ProjectBar({ project, onSwitch, beforeRead, song }: { project: string; onSwitch: (id: string) => void; beforeRead: () => void; song?: Song }) {
    const [mode, setMode] = useState<Mode>({ kind: 'none' });
    const [error, setError] = useState('');
    const [, setTick] = useState(0);
    const list = projects().list;
    const current = list.find((p) => p.id === project);
    const area = useRef<HTMLTextAreaElement>(null);
    const [midi, setMidiState] = useState<MidiOptions>(loadMidiOptions);
    const setMidi = (o: MidiOptions) => {
        setMidiState(o);
        saveMidiOptions(o);
    };
    const exportMidi = () =>
        run(() => {
            beforeRead();
            downloadMidi(song ?? loadProject(project), current?.name ?? 'Song', midi);
        });

    // close the panels when the project changes from elsewhere; another song: all tracks again
    useEffect(() => {
        setMode({ kind: 'none' });
        setMidiState((o) => ({ ...o, exclude: [] }));
    }, [project]);

    const run = async (fn: () => void | Promise<void>) => {
        setError('');
        try {
            await fn();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    const toggle = (kind: Mode['kind'], open: () => void | Promise<void>) =>
        mode.kind === kind ? setMode({ kind: 'none' }) : run(open);

    return (
        <section className="space-y-2 rounded-xl border border-zinc-200 bg-white px-5 py-2.5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400" htmlFor="muop-project">
                    Project
                </label>
                <select
                    id="muop-project"
                    value={project}
                    onChange={(e) => run(() => onSwitch(e.target.value))}
                    className="min-w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                    {list.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.name}
                        </option>
                    ))}
                </select>
                <IconButton icon="plus" label="New project (starter groove)" onClick={() => run(() => onSwitch(createProject().id))} />
                <IconButton
                    icon="copy"
                    label="Duplicate project"
                    onClick={() =>
                        run(() => {
                            beforeRead();
                            onSwitch(duplicateProject(project).id);
                        })
                    }
                />
                <IconButton
                    icon="pencil"
                    label="Rename project"
                    on={mode.kind === 'rename'}
                    onClick={() => toggle('rename', () => setMode({ kind: 'rename', name: current?.name ?? '' }))}
                />
                <IconButton icon="trash" label="Delete project" on={mode.kind === 'delete'} onClick={() => toggle('delete', () => setMode({ kind: 'delete' }))} />
                <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
                <IconButton
                    icon="upload"
                    label="Export: the project as a text to copy (chat, mail, notes)"
                    on={mode.kind === 'export'}
                    onClick={() =>
                        toggle('export', async () => {
                            beforeRead();
                            setMode({ kind: 'export', text: await exportProject(project), copied: false });
                        })
                    }
                />
                <IconButton
                    icon="download"
                    label="Import: paste an exported project"
                    on={mode.kind === 'import'}
                    onClick={() => toggle('import', () => setMode({ kind: 'import', text: '' }))}
                />
                <span className="inline-flex">
                    <button
                        className={`${ICON_BTN} rounded-r-none`}
                        title={`Export MIDI file (.mid): ${midi.source === 'chain' ? 'the chain' : 'all patterns'}, ${midi.repeat === 'align' ? 'until aligned' : `×${midi.repeat}`}${midi.exclude?.length ? `, ${midi.exclude.length} tracks left out` : ''} (options: arrow)`}
                        aria-label="Export MIDI file"
                        onClick={exportMidi}
                    >
                        <Icon name="midi" />
                    </button>
                    <button
                        className={`${mode.kind === 'midi' ? ICON_BTN_ON : ICON_BTN} -ml-px w-5 rounded-l-none`}
                        title="MIDI export options"
                        aria-label="MIDI export options"
                        aria-pressed={mode.kind === 'midi'}
                        onClick={() =>
                            toggle('midi', () => {
                                beforeRead();
                                setMode({ kind: 'midi' });
                            })
                        }
                    >
                        <Icon name="chevron" />
                    </button>
                </span>
                <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500" title="Projects are stored in this browser (localStorage)">
                    saved automatically
                </span>
            </div>

            {mode.kind === 'rename' && (
                <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        run(() => {
                            renameProject(project, mode.name);
                            setMode({ kind: 'none' });
                        });
                    }}
                >
                    <input autoFocus className={FIELD} value={mode.name} onChange={(e) => setMode({ kind: 'rename', name: e.target.value })} />
                    <IconButton icon="check" label="Save name" type="submit" disabled={!mode.name.trim()} />
                </form>
            )}

            {mode.kind === 'delete' && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                        autoFocus
                        className={BTN_RED}
                        onClick={() =>
                            run(() => {
                                const next = deleteProject(project);
                                setMode({ kind: 'none' });
                                setTick((t) => t + 1);
                                onSwitch(next);
                            })
                        }
                    >
                        Yes, delete “{current?.name}”
                    </button>
                    <button className={BTN} onClick={() => setMode({ kind: 'none' })}>
                        Cancel
                    </button>
                    <span className="text-zinc-500 dark:text-zinc-400">Can't be undone. Export it first to keep a copy.</span>
                </div>
            )}

            {mode.kind === 'export' && (
                <div className="space-y-1.5">
                    <textarea ref={area} readOnly rows={3} className={FIELD} value={mode.text} onFocus={(e) => e.currentTarget.select()} />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <IconButton
                            icon={mode.copied ? 'check' : 'clipboard'}
                            label={mode.copied ? 'Copied' : 'Copy to the clipboard'}
                            onClick={() =>
                                run(async () => {
                                    try {
                                        await navigator.clipboard.writeText(mode.text);
                                    } catch {
                                        area.current?.select(); // clipboard blocked: select it for Cmd+C
                                        throw new Error('Copying was blocked: the text is selected, press Cmd+C / Ctrl+C');
                                    }
                                    setMode({ ...mode, copied: true });
                                })
                            }
                        />
                        <span>
                            {mode.text.length.toLocaleString()} characters · paste it into Import (here or on another computer). Not included: favorites, audio inputs.
                        </span>
                    </div>
                </div>
            )}

            {mode.kind === 'midi' && <MidiPanel song={song} project={project} options={midi} onChange={setMidi} onExport={exportMidi} />}

            {mode.kind === 'import' && (
                <form
                    className="space-y-1.5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        run(async () => {
                            const p = await importProject(mode.text);
                            setMode({ kind: 'none' });
                            onSwitch(p.id);
                        });
                    }}
                >
                    <textarea
                        autoFocus
                        rows={3}
                        className={FIELD}
                        placeholder="Paste an exported project (muop1:…)"
                        value={mode.text}
                        onChange={(e) => setMode({ kind: 'import', text: e.target.value })}
                    />
                    <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <button className={BTN} type="submit" disabled={!mode.text.trim()}>
                            Import as new project
                        </button>
                        <span>Adds a project, nothing is overwritten.</span>
                    </div>
                </form>
            )}

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </section>
    );
}

/** MIDI export options: which patterns, how often, which tracks; shows what the file will contain. Follows the live song. */
function MidiPanel({ song: live, project, options, onChange, onExport }: { song?: Song; project: string; options: MidiOptions; onChange: (o: MidiOptions) => void; onExport: () => void }) {
    const [stored] = useState(() => (live ? null : loadProject(project))); // no device: read it once
    const song = live ?? stored!;
    const chain = midiSequence(song, 'chain');
    const all = midiSequence(song, 'all');
    const plan = midiPlan(song, options);
    const align = midiPlan(song, { ...options, repeat: 'align' });
    const exclude = options.exclude ?? [];
    const used = midiTracks(song);
    const count = midiTracks(song, exclude).length; // exclude may name tracks emptied since
    const list = (seq: number[]) => (seq.length > 8 ? `${seq.length} patterns` : seq.map((p) => p + 1).join(' '));
    const toggleTrack = (i: number) => onChange({ ...options, exclude: exclude.includes(i) ? exclude.filter((x) => x !== i) : [...exclude, i] });
    const chip = (on: boolean) =>
        on
            ? 'rounded-md bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
            : 'rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-400 line-through hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800';
    return (
        <div className="space-y-2 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="flex items-center gap-2">
                    Patterns
                    <Segmented
                        value={options.source}
                        onChange={(source) => onChange({ ...options, source })}
                        options={[
                            { value: 'chain', label: `Chain (${list(chain)})`, title: 'The pattern chain as it plays (change it on the device: the list follows)' },
                            { value: 'all', label: `All (${list(all) || 'none'})`, title: 'Every pattern with notes, in order, one bar each' },
                        ]}
                    />
                </span>
                <span className="flex items-center gap-2">
                    Repeat
                    <Segmented<MidiRepeat>
                        value={options.repeat}
                        onChange={(repeat) => onChange({ ...options, repeat })}
                        options={[
                            ...([1, 2, 4, 8] as const).map((r) => ({ value: r, label: `×${r}` })),
                            {
                                value: 'align',
                                label: align.aligned ? `until aligned (×${align.passes})` : `until aligned (>×${MAX_PASSES})`,
                                title: 'Repeats until every exported track starts its loop together again (tracks with other lengths / rates)',
                            },
                        ]}
                    />
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-0.5">Tracks</span>
                <button
                    type="button"
                    className={chip(count === used.length)}
                    title="All tracks"
                    onClick={() => onChange({ ...options, exclude: count === used.length ? used : [] })}
                >
                    All
                </button>
                {used.map((i) => (
                    <button
                        key={i}
                        type="button"
                        className={chip(!exclude.includes(i))}
                        aria-pressed={!exclude.includes(i)}
                        title={`${song.tracks[i].name} (${song.tracks[i].kind}): click to ${exclude.includes(i) ? 'add it' : 'leave it out'}`}
                        onClick={() => toggleTrack(i)}
                    >
                        {song.tracks[i].name}
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button className={BTN} onClick={onExport} disabled={!plan.sequence.length || !count}>
                    Export .mid
                </button>
                <span>
                    {!plan.sequence.length
                        ? 'no pattern with notes'
                        : !count
                          ? 'no track chosen'
                          : `${plan.bars} ${plan.bars === 1 ? 'bar' : 'bars'}, ${count} ${count === 1 ? 'track' : 'tracks'}`}
                    {!plan.aligned && ` (capped at ×${MAX_PASSES}, not aligned)`} · a marker per pattern, the song key · not included: sounds, FX, mute / solo
                </span>
            </div>
        </div>
    );
}
