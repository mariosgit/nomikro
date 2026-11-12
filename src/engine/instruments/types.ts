// Instrument contract: what a track plays through. Times are AudioContext seconds (see toAudioTime()).
// Engines: ./basic.ts (plain Web Audio), ./tone.ts (Tone.js, loaded on demand). Registry: ./index.ts.

/** The 8 drum slots every kit implements, in order. */
export const DRUM_ROLES = ['Kick', 'Snare', 'Closed hat', 'Open hat', 'Clap', 'Low tom', 'High tom', 'Cowbell'] as const;

export interface Voice {
    /** Starts the release at audio time t (default: now). */
    release(t?: number): void;
}

export interface DrumKit {
    /** Drum slot 0..7 (DRUM_ROLES) at audio time t, velocity 0..1. */
    trigger(sound: number, t: number, velocity: number): void;
    dispose(): void;
}

export interface Melodic {
    /** Note at audio time t. With `duration` (s) it releases by itself, otherwise call release(). */
    note(midi: number, t: number, velocity: number, duration?: number): Voice;
    dispose(): void;
}

export interface InstrumentDef<T> {
    id: string;
    /** Synth type, shown on the device display (e.g. "FM", "Pad"). */
    name: string;
    /** Engine it runs on (e.g. "Tone.js"), shown on the page only. */
    engine: string;
    /**
     * Builds the instrument, connected to `out`. `random`: a random variation of its settings
     * (STAR button: a new sound on the fly, not stored).
     */
    create(ctx: AudioContext, out: AudioNode, random?: boolean): Promise<T>;
}

/**
 * Parameter helper for engines: the default value, or (random = true) a random value from a range / a list.
 * One code path for the normal and the randomized sound.
 */
export function chooser(random: boolean) {
    return {
        num: (value: number, min: number, max: number) => (random ? min + Math.random() * (max - min) : value),
        pick: <T,>(value: T, options: readonly T[]) => (random ? options[Math.floor(Math.random() * options.length)] : value),
    };
}

export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
