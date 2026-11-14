// μOp undo history of pattern edits (steps, recorded hits / FX, erase, paste, nudge, …).
// Every edit stores the pattern as it was before (`edit()` is called before changing it). Edits are grouped into
// gestures: a gesture lasts while something is held or a recording pass runs (`close()` ends it).
// Step undo / redo = one edit, Undo / Redo = a whole gesture. Settings (tempo, volume, sounds, octave) are not part of it.
import { clonePattern, type Pattern, type Song } from './model';

interface Entry {
    pattern: number;
    /** The pattern before the edit (undo stack) or before the undo (redo stack). */
    snapshot: Pattern;
    gesture: number;
}

const LIMIT = 500;

export class History {
    private undos: Entry[] = [];
    private redos: Entry[] = [];
    private gesture = 0;
    private open = false;

    constructor(private song: Song) {}

    /** Forget everything (another song was loaded into the same Song object). */
    reset(): void {
        this.undos = [];
        this.redos = [];
        this.open = false;
    }

    get canUndo(): boolean {
        return this.undos.length > 0;
    }
    get canRedo(): boolean {
        return this.redos.length > 0;
    }

    /** Call before changing pattern `pattern`. */
    edit(pattern: number): void {
        if (!this.open) {
            this.gesture++;
            this.open = true;
        }
        this.undos.push({ pattern, snapshot: clonePattern(this.song.patterns[pattern]), gesture: this.gesture });
        if (this.undos.length > LIMIT) this.undos.shift();
        this.redos = [];
    }

    /** The current gesture is over (nothing held, no recording pass). */
    close(): void {
        this.open = false;
    }

    /** Undoes one edit (`whole`: the whole last gesture). Returns the number of edits undone. */
    undo(whole: boolean): number {
        return this.move(this.undos, this.redos, whole);
    }

    redo(whole: boolean): number {
        return this.move(this.redos, this.undos, whole);
    }

    /** Pops from `from`, restores its snapshot and pushes the state it replaced onto `to`. */
    private move(from: Entry[], to: Entry[], whole: boolean): number {
        const top = from[from.length - 1];
        if (!top) return 0;
        let n = 0;
        while (from.length && from[from.length - 1].gesture === top.gesture) {
            const e = from.pop()!;
            to.push({ pattern: e.pattern, snapshot: this.song.patterns[e.pattern], gesture: e.gesture });
            this.song.patterns[e.pattern] = e.snapshot;
            n++;
            if (!whole) break;
        }
        this.open = false; // edits after an undo start a new gesture
        return n;
    }
}
