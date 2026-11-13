// Audio inputs (e.g. a synth's USB audio) into the AudioContext. Framework-free.
// getUserMedia with all voice processing off (echo cancellation, noise suppression, auto gain), stereo, low latency.
// Device names (labels) only show once the page has the permission: the first open() asks for it.
// Latency: the input adds ~10–30 ms (USB + input buffer); not compensated here.

export interface InputDevice {
    id: string;
    /** Empty before the permission was granted. */
    label: string;
}

export interface OpenInput {
    node: MediaStreamAudioSourceNode;
    /** The device's name. */
    label: string;
    /** Called once when the device goes away (unplugged, permission revoked). */
    onEnded(fn: () => void): void;
    close(): void;
}

/**
 * The audio inputs (without the "default" / "communications" aliases). Before the permission was granted, browsers
 * hide them (no ids): the list is empty then, see requestInputPermission().
 */
export async function listInputs(): Promise<InputDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
        .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d) => ({ id: d.deviceId, label: d.label }));
}

/** Asks for the microphone permission (opens and closes the default input), so listInputs() shows the devices. */
export async function requestInputPermission(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
}

/** Calls `fn` when devices come or go. Returns an unsubscribe function. */
export function onInputsChange(fn: () => void): () => void {
    const md = navigator.mediaDevices;
    if (!md) return () => {};
    md.addEventListener('devicechange', fn);
    return () => md.removeEventListener('devicechange', fn);
}

/** Opens an input as a source node on `ctx` (asks for the permission the first time). */
export async function openInput(ctx: AudioContext, deviceId: string): Promise<OpenInput> {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: { exact: deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 2 },
            // Chrome: lowest input latency it can do
            latency: { ideal: 0 },
        } as MediaTrackConstraints,
    });
    const track = stream.getAudioTracks()[0];
    const node = new MediaStreamAudioSourceNode(ctx, { mediaStream: stream });
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        node.disconnect();
        for (const t of stream.getTracks()) t.stop();
    };
    return {
        node,
        label: track?.label ?? '',
        onEnded(fn) {
            track?.addEventListener('ended', () => {
                if (!closed) fn();
            });
        },
        close,
    };
}
