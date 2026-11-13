// μOp punch-in FX (PERFORM + pad). Pads 1–8: the selected track's rhythm tricks (step mapping, per track).
// Pads 9–16: global effects on the master bus (src/engine/fx.ts). Momentary; with REC on they're recorded into the pattern.
import type { Color } from '../../maschine';
import type { MasterFxId } from '../../engine/fx';
import { STEPS } from './model';

export type TrackFxKind = { type: 'loop'; length: number } | { type: 'retrig'; hits: number } | { type: 'reverse' } | { type: 'half' };

export interface FxDef {
    name: string;
    color: Color;
    /** Track FX (pads 1–8): how the track's steps are remapped. */
    track?: TrackFxKind;
    /** Global FX (pads 9–16): master bus effect. */
    global?: MasterFxId;
}

/** Index = pad number (0 = bottom left). */
export const FX: readonly FxDef[] = [
    { name: 'Loop 1', color: 'cyan', track: { type: 'loop', length: 1 } },
    { name: 'Loop 2', color: 'cyan', track: { type: 'loop', length: 2 } },
    { name: 'Loop 4', color: 'cyan', track: { type: 'loop', length: 4 } },
    { name: 'Loop 8', color: 'cyan', track: { type: 'loop', length: 8 } },
    { name: 'Retrig x2', color: 'yellow', track: { type: 'retrig', hits: 2 } },
    { name: 'Retrig x3', color: 'yellow', track: { type: 'retrig', hits: 3 } },
    { name: 'Reverse', color: 'yellow', track: { type: 'reverse' } },
    { name: 'Half time', color: 'yellow', track: { type: 'half' } },
    { name: 'LP sweep', color: 'orange', global: 'lowpass' },
    { name: 'HP sweep', color: 'orange', global: 'highpass' },
    { name: 'Gate', color: 'orange', global: 'gate' },
    { name: 'Pump', color: 'orange', global: 'pump' },
    { name: 'Echo', color: 'magenta', global: 'echo' },
    { name: 'Reverb', color: 'magenta', global: 'reverb' },
    { name: 'Crush', color: 'magenta', global: 'crush' },
    { name: 'Slow down', color: 'magenta', global: 'slow' },
];

export const isTrackFx = (fx: number) => FX[fx]?.track !== undefined;

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Where a track takes its notes from while a track FX runs. null = silent on this step (half time). */
export interface FxSource {
    pattern: number;
    step: number;
    /** Hits per step (retrig). */
    hits: number;
}

/**
 * One track FX in action. Engaged at track step `engage` (the track's own step counter, see the sequencer) on
 * (pattern, step); source() maps later track steps to the step to play. The song position keeps running underneath, so releasing returns to where the song would be.
 */
export class TrackFx {
    constructor(
        readonly fx: number,
        private engage: number,
        private pattern: number,
        private step: number,
        /** The track's length (steps it loops over). */
        private length = STEPS,
    ) {}

    source(index: number): FxSource | null {
        const kind = FX[this.fx].track!;
        const k = index - this.engage;
        const at = (step: number, hits = 1): FxSource => ({ pattern: this.pattern, step: mod(step, this.length), hits });
        switch (kind.type) {
            case 'loop': {
                // loop window aligned to the grid (Loop 4 = the current beat), playing on from the press
                const start = this.step - (this.step % kind.length);
                return at(start + ((this.step - start + k) % kind.length));
            }
            case 'retrig':
                return at(this.step, kind.hits);
            case 'reverse':
                return at(this.step - k);
            case 'half':
                return k % 2 === 0 ? at(this.step + k / 2) : null;
        }
    }
}
