// Instrument registry: pick one per track by id. New engine = a file here + entries below.
import { BasicDrums, BasicLead } from './basic';
import { toneDrums, toneFm, toneMono, tonePad } from './tone';
import type { DrumKit, InstrumentDef, Melodic } from './types';

export * from './types';

export const DRUM_KITS: readonly InstrumentDef<DrumKit>[] = [
    { id: 'basic', name: 'Simple kit', engine: 'Basic', create: async (ctx, out, random) => new BasicDrums(ctx, out, random) },
    { id: 'tone', name: 'Membrane kit', engine: 'Tone.js', create: toneDrums },
];

export const MELODIC: readonly InstrumentDef<Melodic>[] = [
    { id: 'basic-lead', name: 'Sub lead', engine: 'Basic', create: async (ctx, out, random) => new BasicLead(ctx, out, random) },
    { id: 'tone-mono', name: 'Mono lead', engine: 'Tone.js', create: toneMono },
    { id: 'tone-fm', name: 'FM', engine: 'Tone.js', create: toneFm },
    { id: 'tone-pad', name: 'Pad', engine: 'Tone.js', create: tonePad },
];

/** The def with this id, or the first one. */
export const findInstrument = <T,>(defs: readonly InstrumentDef<T>[], id: string | undefined) => defs.find((d) => d.id === id) ?? defs[0];

/** The def `step` places after `id` (wraps, ±), for cycling through engines on the device. */
export const nextInstrument = <T,>(defs: readonly InstrumentDef<T>[], id: string, step = 1) =>
    defs[(((defs.findIndex((d) => d.id === id) + step) % defs.length) + defs.length) % defs.length];
