// Instrument registry: pick one per track by id. New engine = a file here + entries below.
import { BasicDrums, BasicLead } from './basic';
import { TONE_DRUM_PARAMS, TONE_FM_PARAMS, TONE_MONO_PARAMS, TONE_PAD_PARAMS, toneDrums, toneFm, toneMono, tonePad } from './tone';
import type { DrumKit, InstrumentDef, Melodic } from './types';

export * from './types';

export const DRUM_KITS: readonly InstrumentDef<DrumKit>[] = [
    { id: 'basic', name: 'Simple kit', engine: 'Basic', params: BasicDrums.params, create: async (ctx, out, params) => new BasicDrums(ctx, out, params) },
    { id: 'tone', name: 'Membrane kit', engine: 'Tone.js', params: TONE_DRUM_PARAMS, create: toneDrums },
];

export const MELODIC: readonly InstrumentDef<Melodic>[] = [
    { id: 'basic-lead', name: 'Sub lead', engine: 'Basic', params: BasicLead.params, create: async (ctx, out, params) => new BasicLead(ctx, out, params) },
    { id: 'tone-mono', name: 'Mono lead', engine: 'Tone.js', params: TONE_MONO_PARAMS, create: toneMono },
    { id: 'tone-fm', name: 'FM', engine: 'Tone.js', params: TONE_FM_PARAMS, create: toneFm },
    { id: 'tone-pad', name: 'Pad', engine: 'Tone.js', params: TONE_PAD_PARAMS, create: tonePad },
];

/** The def with this id, or the first one. */
export const findInstrument = <T,>(defs: readonly InstrumentDef<T>[], id: string | undefined) => defs.find((d) => d.id === id) ?? defs[0];

/** The def `step` places after `id` (wraps, ±), for cycling through engines on the device. */
export const nextInstrument = <T,>(defs: readonly InstrumentDef<T>[], id: string, step = 1) =>
    defs[(((defs.findIndex((d) => d.id === id) + step) % defs.length) + defs.length) % defs.length];
