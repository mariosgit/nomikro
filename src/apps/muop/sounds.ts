// μOp sound: one instrument per track (chosen from the engine registry, src/engine/instruments/),
// each → track gain (track volume) → low-pass (touch strip) → master gain (volume) → speakers.
import type { Color } from '../../maschine';
import { DRUM_KITS, DRUM_ROLES, MELODIC, findInstrument, type DrumKit, type InstrumentDef, type Melodic, type Voice } from '../../engine/instruments';
import type { TrackKind } from './model';

const DRUM_COLORS: Color[] = ['red', 'orange', 'yellow', 'lime', 'cyan', 'blue', 'violet', 'magenta'];
export const DRUM_SOUNDS = DRUM_ROLES.map((name, i) => ({ name, color: DRUM_COLORS[i] }));

/** Instruments a track kind can use: drum kits for drums, melodic instruments for notes / chords. */
export const soundsFor = (kind: TrackKind): readonly InstrumentDef<DrumKit | Melodic>[] => (kind === 'drums' ? DRUM_KITS : MELODIC);

const OPEN = 20000;
const SILENT: Voice = { release() {} };

interface Slot {
    drums: DrumKit | null;
    melodic: Melodic | null;
    id: string;
    /** A random variation (STAR), not stored in the song. */
    random: boolean;
    /** Track volume. */
    gain: GainNode;
    /** Bumped per load, so only the latest of overlapping loads wins. */
    loading: number;
}

export class Sounds {
    private master: GainNode;
    private filter: BiquadFilterNode;
    private disposed = false;
    private slots = new Map<number, Slot>();

    constructor(readonly ctx: AudioContext) {
        this.filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: OPEN, Q: 4 });
        this.master = new GainNode(ctx, { gain: 0.8 });
        this.filter.connect(this.master).connect(ctx.destination);
    }

    /** True while the track plays a random variation (STAR). */
    isRandom(track: number): boolean {
        return this.slots.get(track)?.random ?? false;
    }

    /** Track volume 0..1.5 (1 = as designed). */
    setLevel(track: number, level: number): void {
        this.slot(track).gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02);
    }

    /**
     * Switches a track's instrument; `random` = a random variation of it. Resolves with the instrument's name once it
     * plays (the old one plays until then).
     */
    async set(track: number, kind: TrackKind, id: string, random = false): Promise<string> {
        const slot = this.slot(track);
        const def = findInstrument(soundsFor(kind), id);
        slot.id = def.id;
        slot.random = random;
        const token = ++slot.loading;
        const instrument = await def.create(this.ctx, slot.gain, random);
        if (this.disposed || token !== slot.loading) {
            instrument.dispose(); // superseded
            return def.name;
        }
        const old = slot.drums ?? slot.melodic;
        slot.drums = kind === 'drums' ? (instrument as DrumKit) : null;
        slot.melodic = kind === 'drums' ? null : (instrument as Melodic);
        if (old) setTimeout(() => old.dispose(), 2000); // let its tails ring out
        return def.name;
    }

    set volume(v: number) {
        this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }

    /** Low-pass cutoff 0..1 (exponential 150 Hz..20 kHz), null = open. */
    setFilter(amount: number | null): void {
        const hz = amount === null ? OPEN : 150 * Math.pow(OPEN / 150, Math.min(1, Math.max(0, amount)));
        this.filter.frequency.setTargetAtTime(hz, this.ctx.currentTime, amount === null ? 0.08 : 0.02);
    }

    drum(track: number, sound: number, t: number, velocity: number): void {
        this.slots.get(track)?.drums?.trigger(sound, t, velocity);
    }

    note(track: number, midi: number, t: number, velocity: number, duration?: number): Voice {
        return this.slots.get(track)?.melodic?.note(midi, t, velocity, duration) ?? SILENT;
    }

    dispose(): void {
        this.disposed = true;
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
        setTimeout(() => {
            for (const slot of this.slots.values()) (slot.drums ?? slot.melodic)?.dispose();
            this.master.disconnect();
        }, 300);
    }

    private slot(track: number): Slot {
        let slot = this.slots.get(track);
        if (!slot) {
            const gain = new GainNode(this.ctx, { gain: 1 });
            gain.connect(this.filter);
            slot = { drums: null, melodic: null, id: '', random: false, gain, loading: 0 };
            this.slots.set(track, slot);
        }
        return slot;
    }
}
