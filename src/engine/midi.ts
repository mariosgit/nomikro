// Web MIDI out: ports, notes with timestamps (performance.now() ms, the clock's timebase).
// Access is requested on demand (Chrome asks the user once); until then there are no ports and sends are dropped.

export interface MidiPortInfo {
    id: string;
    name: string;
}

/** A sounding MIDI note; release() sends the note off now (live notes without a duration). */
export interface MidiVoice {
    release(): void;
}

let access: MIDIAccess | null = null;
let pending: Promise<MIDIAccess | null> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Asks for MIDI access (once; again after a denial). Resolves null if there's no Web MIDI or it was denied. */
export function requestMidi(): Promise<MIDIAccess | null> {
    if (!navigator.requestMIDIAccess) return Promise.resolve(null);
    pending ??= navigator.requestMIDIAccess().then(
        (a) => {
            access = a;
            a.addEventListener('statechange', notify);
            notify();
            return a;
        },
        () => {
            pending = null;
            return null;
        },
    );
    return pending;
}

export const midiReady = () => access !== null;

/** Output ports (empty until requestMidi() resolved). */
export function midiOutputs(): MidiPortInfo[] {
    return access ? [...access.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id })) : [];
}

/** Ports appeared / disappeared, or access was granted. Returns an unsubscribe function. */
export function onMidiChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Sends raw bytes at `time` (performance.now() ms, omitted = now). False if the port isn't there. */
export function midiSend(port: string, data: number[], time?: number): boolean {
    const out = access?.outputs.get(port);
    if (!out || out.state !== 'connected') return false;
    try {
        out.send(data, time);
        return true;
    } catch {
        return false;
    }
}

const clamp7 = (v: number) => Math.min(127, Math.max(0, Math.round(v)));

/**
 * Note on at `time` (ms), velocity 0..1, channel 1..16. With `duration` (ms) the note off is scheduled too;
 * without, it sounds until release().
 */
export function midiNote(port: string, channel: number, note: number, velocity: number, time: number, duration?: number): MidiVoice {
    const ch = (channel - 1) & 0x0f;
    const n = clamp7(note);
    midiSend(port, [0x90 | ch, n, Math.max(1, clamp7(velocity * 127))], time);
    let open = true;
    const off = (at?: number) => {
        if (!open) return;
        open = false;
        midiSend(port, [0x80 | ch, n, 0], at);
    };
    if (duration !== undefined) off(time + duration);
    return { release: () => off() };
}

/** All notes off (CC 123) on a channel, now. */
export function midiAllOff(port: string, channel: number): void {
    midiSend(port, [0xb0 | ((channel - 1) & 0x0f), 123, 0]);
}
