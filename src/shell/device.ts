// Shared device runner: whoever drives the device (an app, a lab mode) runs as a task.
// Tasks run strictly one after another across all apps, so the old task's cleanup can't wipe the next one's lights.
import { useEffect, type DependencyList } from 'react';
import type { MaschineMikroMk3 } from '../maschine';
import { devlog } from '../dev/devlog';

/** Owns the device until the signal aborts. Should turn its lights off before returning. */
export type DeviceTask = (m: MaschineMikroMk3, signal: AbortSignal) => Promise<void>;

let running: Promise<void> = Promise.resolve();

/** Hands the device back in a neutral state: no input callbacks / listeners / light layers left behind, lights off. */
async function release(m: MaschineMikroMk3): Promise<void> {
    m.setPadCallback(() => {});
    m.setButtonCallback(null);
    m.onRawInput = null;
    m.input.removeAllListeners();
    m.screen.blankAfter = 3000;
    m.lights.removeLayer();
    m.lights.clear();
    await m.lights.flush();
}

/**
 * Runs `task` on the device while the component is mounted and `maschine` is connected.
 * It is aborted and restarted when `deps` change, and aborted on unmount (app switch).
 */
export function useDeviceTask(maschine: MaschineMikroMk3 | null, task: DeviceTask, deps: DependencyList, name = 'task'): void {
    useEffect(() => {
        if (!maschine) return;
        const ctrl = new AbortController();
        const previous = running;
        running = (async () => {
            await previous;
            if (ctrl.signal.aborted) return;
            devlog('task', { task: name });
            try {
                await task(maschine, ctrl.signal);
            } finally {
                await release(maschine);
            }
        })().catch((error) => {
            console.error(`${name} failed:`, error);
            devlog('error', { task: name, error: String(error) });
        });
        return () => ctrl.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [maschine, ...deps]);
}
