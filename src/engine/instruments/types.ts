// Instrument contract: what a track plays through. Times are AudioContext seconds (see toAudioTime()).
// Engines: ./basic.ts (plain Web Audio), ./tone.ts (Tone.js, loaded on demand). Registry: ./index.ts.
// Every instrument declares its parameters (ParamDef); the values live in the song (per track) and in favorites.

/** The 8 drum slots every kit implements, in order. */
export const DRUM_ROLES = ['Kick', 'Snare', 'Closed hat', 'Open hat', 'Clap', 'Low tom', 'High tom', 'Cowbell'] as const;

export interface Voice {
    /** Starts the release at audio time t (default: now). */
    release(t?: number): void;
}

/** Live parameter changes. Without `set`, the mixer rebuilds the instrument (debounced). */
export interface Tweakable {
    set?(params: Params): void;
}

export interface DrumKit extends Tweakable {
    /** Drum slot 0..7 (DRUM_ROLES) at audio time t, velocity 0..1. */
    trigger(sound: number, t: number, velocity: number): void;
    dispose(): void;
}

export interface Melodic extends Tweakable {
    /** Note at audio time t. With `duration` (s) it releases by itself, otherwise call release(). */
    note(midi: number, t: number, velocity: number, duration?: number): Voice;
    dispose(): void;
}

/**
 * A sound parameter. Values are plain numbers in the param's unit; `options` = a choice (value = index).
 * `log`: encoder steps / random values are spread logarithmically (frequencies, times). `random`: the range
 * RANDOMIZE picks from (default min..max), to keep random sounds musical.
 */
export interface ParamDef {
    id: string;
    name: string;
    min: number;
    max: number;
    default: number;
    unit?: 'Hz' | 's' | '%' | 'x' | 'st';
    log?: boolean;
    /** Whole numbers only (counts, semitones). */
    int?: boolean;
    options?: readonly string[];
    random?: readonly [number, number];
    /** Drum kits: the drum sound it belongs to (DRUM_ROLES name). */
    group?: string;
}

/** Parameter values by id; missing ids = the default. */
export type Params = Record<string, number>;

export interface InstrumentDef<T> {
    id: string;
    /** Synth type, shown on the device display (e.g. "FM", "Pad"). */
    name: string;
    /** Engine it runs on (e.g. "Tone.js"), shown on the page only. */
    engine: string;
    /** Its parameters (drum kits: drumParams(), ids "<sound>.<id>"). */
    params: readonly ParamDef[];
    /** Builds the instrument with these values (missing = defaults), connected to `out`. */
    create(ctx: AudioContext, out: AudioNode, params: Params): Promise<T>;
}

/** Steps the encoder takes over a parameter's range. */
const ENCODER_STEPS = 48;

export function clampParam(def: ParamDef, v: number): number {
    const c = Math.min(def.max, Math.max(def.min, Number.isFinite(v) ? v : def.default));
    return def.int || def.options ? Math.round(c) : c;
}

/** All values with the defaults filled in, for engines: `p.cutoff`. */
export function resolve(defs: readonly ParamDef[], params: Params): Params {
    return Object.fromEntries(defs.map((d) => [d.id, clampParam(d, params[d.id] ?? d.default)]));
}

/** One encoder step (± delta) further. */
export function stepParam(def: ParamDef, v: number, delta: number): number {
    if (def.options || def.int) return clampParam(def, Math.round(v) + delta);
    if (def.log && def.min > 0) return clampParam(def, v * Math.pow(def.max / def.min, delta / ENCODER_STEPS));
    return clampParam(def, v + (delta * (def.max - def.min)) / ENCODER_STEPS);
}

/** A random value from the param's random range. */
export function randomParam(def: ParamDef): number {
    if (def.options) return Math.floor(Math.random() * def.options.length);
    const [lo, hi] = def.random ?? [def.min, def.max];
    const u = Math.random();
    return clampParam(def, def.log && lo > 0 ? lo * Math.pow(hi / lo, u) : lo + u * (hi - lo));
}

/** Display text, e.g. "1.2 kHz", "350 ms", "40 %", "saw". */
export function formatParam(def: ParamDef, v: number): string {
    if (def.options) return def.options[Math.round(v)] ?? '?';
    const r = (x: number) => String(Math.abs(x) >= 100 ? Math.round(x) : Number(x.toFixed(Math.abs(x) >= 10 ? 1 : 2)));
    switch (def.unit) {
        case 'Hz':
            return v >= 1000 ? `${r(v / 1000)} kHz` : `${Math.round(v)} Hz`;
        case 's':
            return v >= 1 ? `${r(v)} s` : `${Math.round(v * 1000)} ms`;
        case '%':
            return `${Math.round(v * 100)} %`;
        case 'x':
            return `×${r(v)}`;
        case 'st':
            return `${v > 0 ? '+' : ''}${Math.round(v)} st`;
        default:
            return def.int ? String(Math.round(v)) : r(v);
    }
}

/** The 4 parameters every drum sound has (kits interpret Tone their own way: sweep, filter, metal color). */
const DRUM_PARAM_SET = [
    { id: 'tune', name: 'Tune', min: -12, max: 12, default: 0, unit: 'st', int: true, random: [-7, 7] },
    { id: 'decay', name: 'Decay', min: 0.25, max: 4, default: 1, unit: 'x', log: true, random: [0.5, 2] },
    { id: 'tone', name: 'Tone', min: 0.25, max: 4, default: 1, unit: 'x', log: true, random: [0.5, 2] },
    { id: 'level', name: 'Level', min: 0, max: 1.5, default: 1, unit: '%', random: [0.7, 1.2] },
    { id: 'drive', name: 'Drive', min: 0, max: 1, default: 0, unit: '%', random: [0, 0.5] },
] as const satisfies readonly ParamDef[];

/** Distortion amount of a melodic instrument (applied by the mixer, after the instrument). */
export const DRIVE: ParamDef = { id: 'drive', name: 'Drive', min: 0, max: 1, default: 0, unit: '%', random: [0, 0.4] };

const curves = new Map<number, Float32Array<ArrayBuffer>>();
/** Soft clipping (tanh) curve for a WaveShaper, drive 0..1 (0 = null: straight through). */
export function driveCurve(drive: number): Float32Array<ArrayBuffer> | null {
    const key = Math.round(drive * 50);
    if (key <= 0) return null;
    let curve = curves.get(key);
    if (!curve) {
        const k = 1 + (key / 50) ** 1.5 * 40;
        curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1;
            curve[i] = Math.tanh(k * x) / Math.tanh(k);
        }
        curves.set(key, curve);
    }
    return curve;
}

/** Level after the shaper: distortion gets louder, this keeps it about even. */
export const driveMakeup = (drive: number) => 1 / (1 + 1.6 * drive);

/** A drive stage (WaveShaper → makeup gain) into `out`. Returns its input; update() changes the amount live. */
export function driveStage(ctx: BaseAudioContext, out: AudioNode, drive = 0) {
    const shaper = new WaveShaperNode(ctx, { oversample: '2x' });
    const makeup = new GainNode(ctx);
    shaper.connect(makeup).connect(out);
    const update = (d: number) => {
        shaper.curve = driveCurve(d);
        makeup.gain.value = driveMakeup(d);
    };
    update(drive);
    return { input: shaper as AudioNode, update, dispose: () => makeup.disconnect() };
}

export interface DrumValues {
    tune: number;
    decay: number;
    tone: number;
    level: number;
    drive: number;
}

/** Drum kit params: the set above for each of the 8 drum sounds, ids "<sound>.<id>". */
export const drumParams = (): ParamDef[] => DRUM_ROLES.flatMap((role, d) => DRUM_PARAM_SET.map((p) => ({ ...p, id: `${d}.${p.id}`, group: role })));

/** A drum sound's values (defaults filled in). */
export function drumValues(params: Params, sound: number): DrumValues {
    const v = (def: ParamDef) => clampParam(def, params[`${sound}.${def.id}`] ?? def.default);
    const [tune, decay, tone, level, drive] = DRUM_PARAM_SET.map(v);
    return { tune, decay, tone, level, drive };
}

/** Semitones → frequency factor. */
export const semis = (st: number) => Math.pow(2, st / 12);

export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
