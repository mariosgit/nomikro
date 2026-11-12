// Mode contract: a mode owns the device while it runs. Add a mode = one file + one entry in ./index.ts.
import type { MaschineMikroMk3 } from '../../maschine';

export interface ModeContext {
    params: Record<string, string>;
    /** Line for the page's event list (also goes to the dev log). */
    log(line: string, data?: unknown): void;
}

export interface Mode {
    label: string;
    help: string;
    /** Owns the device until the signal aborts. Must turn everything off before returning. */
    run(m: MaschineMikroMk3, signal: AbortSignal, ctx: ModeContext): Promise<void>;
}

/** Resolves when the mode should stop. */
export const untilAborted = (signal: AbortSignal) =>
    new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener('abort', () => resolve(), { once: true })));
