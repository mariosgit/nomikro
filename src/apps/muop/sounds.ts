// μOp sound: one instrument per track (chosen from the engine registry, src/engine/instruments/),
// each → track gain (track volume) → low-pass (touch strip) → punch-in FX bus → master gain (volume) → speakers.
import type { Color } from '../../maschine';
import { DRIVE, DRUM_KITS, DRUM_ROLES, MELODIC, clampParam, driveStage, findInstrument, type DrumKit, type InstrumentDef, type Melodic, type Params, type Voice } from '../../engine/instruments';
import type { TrackKind, TrackMidi } from './model';
import { midiAllOff, midiNote } from '../../engine/midi';
import { fromAudioTime } from '../../engine/audio';
import { MasterFx } from '../../engine/fx';

const DRUM_COLORS: Color[] = ['red', 'orange', 'yellow', 'lime', 'cyan', 'blue', 'violet', 'magenta'];
/** General MIDI drum notes, in DRUM_ROLES order (kick, snare, closed hat, open hat, clap, low tom, high tom, cowbell). */
const GM_DRUMS = [36, 38, 42, 46, 39, 45, 50, 56];
export const DRUM_SOUNDS = DRUM_ROLES.map((name, i) => ({ name, color: DRUM_COLORS[i], gm: GM_DRUMS[i] }));
const DRUM_MIDI_MS = 50;

/** Instruments a track kind can use: drum kits for drums, melodic instruments for notes / chords. */
export const soundsFor = (kind: TrackKind): readonly InstrumentDef<DrumKit | Melodic>[] => (kind === 'drums' ? DRUM_KITS : MELODIC);

const OPEN = 20000;
const SILENT: Voice = { release() {} };

interface Slot {
    drums: DrumKit | null;
    melodic: Melodic | null;
    id: string;
    kind: TrackKind | null;
    /** Pending rebuild after a parameter change (instruments without live set()). */
    rebuild: ReturnType<typeof setTimeout> | undefined;
    /** Track volume. */
    gain: GainNode;
    /** Level meter after the track volume. */
    analyser: AnalyserNode;
    peakHold: number;
    /** The track's bus drive (params.drive). Instruments play into it. */
    drive: ReturnType<typeof driveStage>;
    /** Bumped per load, so only the latest of overlapping loads wins. */
    loading: number;
    /** MIDI out instead of the instrument. */
    midi: TrackMidi | null;
    /** Preloaded for a song switch, not playing yet (install()). */
    next: { instrument: DrumKit | Melodic; kind: TrackKind; id: string; params: Params } | null;
}

export class Sounds {
    private master: GainNode;
    private filter: BiquadFilterNode;
    /** Punch-in FX on the whole mix (PERFORM + pads 9–16). */
    readonly fx: MasterFx;
    private disposed = false;
    /** Taps the master output for the level meter. */
    private analyser: AnalyserNode;
    private meterBuffer: Float32Array<ArrayBuffer>;
    private peakHold = 0;
    private overUntil = 0;
    /** Audio inputs (USB audio of external synths), summed: level / mute here, then strip filter → FX bus. */
    private inputBus: GainNode;
    private inputAnalyser: AnalyserNode;
    private inputHold = 0;
    private slots = new Map<number, Slot>();

    constructor(readonly ctx: AudioContext) {
        this.filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: OPEN, Q: 4 });
        this.master = new GainNode(ctx, { gain: 0.8 });
        this.fx = new MasterFx(ctx);
        this.filter.connect(this.fx.input);
        this.fx.output.connect(this.master).connect(ctx.destination);
        this.analyser = new AnalyserNode(ctx, { fftSize: 2048 });
        this.master.connect(this.analyser);
        this.meterBuffer = new Float32Array(this.analyser.fftSize);
        this.inputBus = new GainNode(ctx, { gain: 1 });
        this.inputAnalyser = new AnalyserNode(ctx, { fftSize: 1024 });
        this.inputBus.connect(this.filter);
        this.inputBus.connect(this.inputAnalyser);
    }

    /** Track volume 0..1.5 (1 = as designed). */
    setLevel(track: number, level: number): void {
        this.slot(track).gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02);
    }

    /**
     * Switches a track's instrument, with its parameter values. Resolves with the instrument's name once it plays
     * (the old one plays until then).
     */
    async set(track: number, kind: TrackKind, id: string, params: Params): Promise<string> {
        const slot = this.slot(track);
        const def = findInstrument(soundsFor(kind), id);
        clearTimeout(slot.rebuild);
        slot.id = def.id;
        slot.kind = kind;
        const token = ++slot.loading;
        this.setDrive(slot, params);
        const instrument = await def.create(this.ctx, slot.drive.input, { ...params });
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

    /**
     * Loads an instrument for a coming song switch without playing it: the track keeps its current sound until
     * install(). A later set() / preload() on the track supersedes it.
     */
    async preload(track: number, kind: TrackKind, id: string, params: Params): Promise<void> {
        const slot = this.slot(track);
        const def = findInstrument(soundsFor(kind), id);
        const token = ++slot.loading;
        slot.next?.instrument.dispose();
        slot.next = null;
        const instrument = await def.create(this.ctx, slot.drive.input, { ...params });
        if (this.disposed || token !== slot.loading) return instrument.dispose();
        slot.next = { instrument, kind, id: def.id, params };
    }

    /** Switches the track to its preloaded instrument (at the song switch). False if none is ready. */
    install(track: number): boolean {
        const slot = this.slots.get(track);
        const next = slot?.next;
        if (!slot || !next) return false;
        clearTimeout(slot.rebuild);
        const old = slot.drums ?? slot.melodic;
        slot.drums = next.kind === 'drums' ? (next.instrument as DrumKit) : null;
        slot.melodic = next.kind === 'drums' ? null : (next.instrument as Melodic);
        slot.id = next.id;
        slot.kind = next.kind;
        slot.next = null;
        this.setDrive(slot, next.params);
        if (old) setTimeout(() => old.dispose(), 2000); // let its tails ring out
        return true;
    }

    /** The track goes silent (empty in the new song). */
    clear(track: number): void {
        const slot = this.slots.get(track);
        if (!slot) return;
        clearTimeout(slot.rebuild);
        slot.loading++;
        const old = slot.drums ?? slot.melodic;
        slot.drums = slot.melodic = null;
        slot.next?.instrument.dispose();
        slot.next = null;
        slot.id = '';
        slot.kind = null;
        if (old) setTimeout(() => old.dispose(), 2000);
    }

    /** New parameter values for the track's instrument: live if it can, else rebuilt shortly after the last change. */
    tweak(track: number, params: Params): void {
        const slot = this.slots.get(track);
        if (!slot?.kind) return;
        this.setDrive(slot, params);
        const instrument = slot.drums ?? slot.melodic;
        if (instrument?.set && slot.loading && !slot.rebuild) {
            instrument.set({ ...params });
            return;
        }
        clearTimeout(slot.rebuild);
        const { kind, id } = slot;
        slot.rebuild = setTimeout(() => {
            slot.rebuild = undefined;
            const at = this.indexOf(slot); // the track may have moved meanwhile
            if (at >= 0) void this.set(at, kind!, id, params);
        }, 120);
    }

    /** The track's bus drive (mixer / PLUG-IN "Drive"; drum kits also drive per drum sound, "0.drive", …). */
    private setDrive(slot: Slot, params: Params): void {
        slot.drive.update(clampParam(DRIVE, params.drive ?? 0));
    }

    /**
     * Master level for the meter (call per animation frame): `peak` 0..1+ of the last ~40 ms, `hold` = falling peak,
     * `over` = a sample reached full scale in the last 1.5 s (clipping: crackles).
     */
    meter(): { peak: number; hold: number; over: boolean } {
        this.analyser.getFloatTimeDomainData(this.meterBuffer);
        let peak = 0;
        for (const v of this.meterBuffer) peak = Math.max(peak, Math.abs(v));
        const now = performance.now();
        if (peak >= 0.999) this.overUntil = now + 1500;
        this.peakHold = Math.max(peak, this.peakHold * 0.97);
        return { peak, hold: this.peakHold, over: now < this.overUntil };
    }

    /** Peak of an analyser's last block. */
    private peakOf(analyser: AnalyserNode): number {
        const buf = this.meterBuffer.subarray(0, analyser.fftSize);
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        return peak;
    }

    /** Connects an audio input into the input bus. Its own level and meter; disconnect() takes it out. */
    connectInput(node: AudioNode): { setLevel(level: number): void; meter(): number; disconnect(): void } {
        const gain = new GainNode(this.ctx, { gain: 1 });
        const analyser = new AnalyserNode(this.ctx, { fftSize: 1024 });
        node.connect(gain);
        gain.connect(this.inputBus);
        gain.connect(analyser);
        return {
            setLevel: (level) => gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02),
            meter: () => this.peakOf(analyser),
            disconnect: () => {
                node.disconnect(gain);
                gain.disconnect();
            },
        };
    }

    /** Level of all inputs together (mixer "Inputs" strip), 0 = muted. */
    setInputsLevel(level: number): void {
        this.inputBus.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02);
    }

    /** The summed inputs' level for the mixer meter. */
    inputsMeter(): { peak: number; hold: number } {
        const peak = this.peakOf(this.inputAnalyser);
        this.inputHold = Math.max(peak, this.inputHold * 0.97);
        return { peak, hold: this.inputHold };
    }

    /** A track's level for the mixer meter (per animation frame): peak of the last ~20 ms and a falling peak. */
    trackMeter(track: number): { peak: number; hold: number } {
        const slot = this.slots.get(track);
        if (!slot) return { peak: 0, hold: 0 };
        const peak = this.peakOf(slot.analyser);
        slot.peakHold = Math.max(peak, slot.peakHold * 0.97);
        return { peak, hold: slot.peakHold };
    }

    set volume(v: number) {
        this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }

    /** Low-pass cutoff 0..1 (exponential 150 Hz..20 kHz), null = open. */
    setFilter(amount: number | null): void {
        const hz = amount === null ? OPEN : 150 * Math.pow(OPEN / 150, Math.min(1, Math.max(0, amount)));
        this.filter.frequency.setTargetAtTime(hz, this.ctx.currentTime, amount === null ? 0.08 : 0.02);
    }

    /** Routes a track to MIDI out (null = back to its instrument). */
    setMidi(track: number, midi: TrackMidi | null): void {
        const slot = this.slot(track);
        if (slot.midi) midiAllOff(slot.midi.port, slot.midi.channel);
        slot.midi = midi && { ...midi };
    }

    /** `t` = audio time (s). */
    drum(track: number, sound: number, t: number, velocity: number): void {
        const slot = this.slots.get(track);
        if (slot?.midi) midiNote(slot.midi.port, slot.midi.channel, DRUM_SOUNDS[sound]?.gm ?? 36, velocity, fromAudioTime(t), DRUM_MIDI_MS);
        else slot?.drums?.trigger(sound, t, velocity);
    }

    /** `t` = audio time (s), `duration` in s (none = until release()). */
    note(track: number, midi: number, t: number, velocity: number, duration?: number): Voice {
        const slot = this.slots.get(track);
        if (slot?.midi) return midiNote(slot.midi.port, slot.midi.channel, midi, velocity, fromAudioTime(t), duration === undefined ? undefined : duration * 1000);
        return slot?.melodic?.note(midi, t, velocity, duration) ?? SILENT;
    }

    dispose(): void {
        this.disposed = true;
        for (const slot of this.slots.values()) if (slot.midi) midiAllOff(slot.midi.port, slot.midi.channel);
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
        setTimeout(() => {
            for (const slot of this.slots.values()) {
                (slot.drums ?? slot.melodic)?.dispose();
                slot.next?.instrument.dispose();
            }
            this.master.disconnect();
        }, 300);
    }

    /** Tracks reordered: new track j plays what was track order[j] (instrument, volume, meter, MIDI out move along). */
    moveSlots(order: readonly number[]): void {
        const old = this.slots;
        this.slots = new Map();
        order.forEach((from, to) => {
            const slot = old.get(from);
            if (slot) this.slots.set(to, slot);
        });
    }

    private indexOf(slot: Slot): number {
        for (const [i, s] of this.slots) if (s === slot) return i;
        return -1;
    }

    private slot(track: number): Slot {
        let slot = this.slots.get(track);
        if (!slot) {
            const gain = new GainNode(this.ctx, { gain: 1 });
            gain.connect(this.filter);
            const drive = driveStage(this.ctx, gain);
            const analyser = new AnalyserNode(this.ctx, { fftSize: 1024 });
            gain.connect(analyser);
            slot = { drums: null, melodic: null, id: '', kind: null, rebuild: undefined, gain, drive, analyser, peakHold: 0, loading: 0, midi: null, next: null };
            this.slots.set(track, slot);
        }
        return slot;
    }
}
