// Shared AudioContext + time conversion from the clock's timebase (performance.now() ms) to audio time.
//
// Browsers start an AudioContext only after a user gesture on the page (a click; pad presses on the device don't count).
// unlockAudioOnGesture() resumes it on the first click / key press.

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
    return (ctx ??= new AudioContext({ latencyHint: 'interactive' }));
}

/** True once audio can actually play. */
export const audioRunning = () => ctx?.state === 'running';

/** Resumes the AudioContext on the next click / key press on the page (and again if it got suspended). */
export function unlockAudioOnGesture(): void {
    const resume = () => {
        const c = audioContext();
        if (c.state !== 'running') c.resume();
    };
    for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, resume, { capture: true });
}

/**
 * performance.now() ms → AudioContext time (s), so that the sound is *heard* at that moment:
 * getOutputTimestamp() maps the sample currently leaving the speakers to its performance time (includes output latency).
 * Never earlier than currentTime (too late events play immediately).
 */
export function toAudioTime(time: number): number {
    const c = audioContext();
    const { contextTime, performanceTime } = c.getOutputTimestamp();
    const t =
        contextTime !== undefined && performanceTime !== undefined && performanceTime > 0
            ? contextTime + (time - performanceTime) / 1000
            : c.currentTime + (time - performance.now()) / 1000;
    return Math.max(c.currentTime, t);
}
