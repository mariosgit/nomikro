// Touch strip with two fingers. The device reports up to two positions (bytes 9 and 11), sorted left → right,
// not in touch order: a finger passed by a new one on its left moves from position to position2. StripFingers follows
// each finger by continuity (nearest new position), so it keeps its identity (slot) while it stays down.
import { STRIP_MAX } from './hardware';

export interface Finger {
    /** 1..STRIP_MAX. */
    pos: number;
    /** Position in the previous report (= pos on touch down): pos - prev = this report's move. */
    prev: number;
    /** 0 = the first finger down, 1 = a second one (gets the free slot when one lifts and touches again). */
    slot: 0 | 1;
}

export interface Pinch {
    /** Middle between the fingers, 0..1. */
    center: number;
    /** Finger distance, 0..1: 0 up to `min` positions apart, 1 from `full` of the strip width on. */
    width: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Strip position 1..STRIP_MAX → 0..1. */
export const stripValue = (pos: number) => clamp01((pos - 1) / (STRIP_MAX - 1));

export class StripFingers {
    /** The fingers down, in no particular order. */
    fingers: Finger[] = [];
    /** Most fingers down at once since the strip was last free (2 after a pinch, until all are lifted). */
    peak = 0;

    /** Feed every `strip` event (position, position2; 0 = none). Returns the fingers. */
    update(position: number, position2: number): Finger[] {
        const points = [position, position2].filter((p) => p > 0);
        this.fingers = follow(this.fingers, points);
        this.peak = points.length ? Math.max(this.peak, points.length) : 0;
        return this.fingers;
    }

    /** The one finger's position 0..1, null with two fingers or after a pinch (lifting one finger must not jump). */
    single(): number | null {
        return this.fingers.length === 1 && this.peak === 1 ? stripValue(this.fingers[0].pos) : null;
    }

    /**
     * Two fingers: center + width. Width: `min` = positions apart that still count as 0 (fingers touching),
     * `full` = share of the strip at which it reaches 1 (a comfortable spread for one hand).
     */
    pinch({ min = 15, full = 0.6 } = {}): Pinch | null {
        if (this.fingers.length !== 2) return null;
        const [a, b] = this.fingers.map((f) => f.pos).sort((x, y) => x - y);
        return { center: stripValue((a + b) / 2), width: clamp01((b - a - min) / (full * (STRIP_MAX - 1) - min)) };
    }
}

function follow(fingers: Finger[], points: number[]): Finger[] {
    if (!points.length) return [];
    if (!fingers.length) return points.map((pos, i) => ({ pos, prev: pos, slot: i ? 1 : 0 }));
    const cont = (f: Finger, pos: number): Finger => ({ pos, prev: f.pos, slot: f.slot });
    if (fingers.length === 1 && points.length === 1) return [cont(fingers[0], points[0])];
    if (fingers.length === 1) {
        // a 2nd finger landed: the nearer point continues the 1st one, the other is new with the free slot
        const [f] = fingers;
        const near = Math.abs(points[0] - f.pos) <= Math.abs(points[1] - f.pos) ? 0 : 1;
        const other = points[1 - near];
        return [cont(f, points[near]), { pos: other, prev: other, slot: f.slot ? 0 : 1 }];
    }
    if (points.length === 1) {
        // one lifted: the nearer finger stays
        const keep = Math.abs(fingers[0].pos - points[0]) <= Math.abs(fingers[1].pos - points[0]) ? fingers[0] : fingers[1];
        return [cont(keep, points[0])];
    }
    // two and two: the pairing with the smaller total move
    const [f, g] = fingers;
    const straight = Math.abs(f.pos - points[0]) + Math.abs(g.pos - points[1]);
    const crossed = Math.abs(f.pos - points[1]) + Math.abs(g.pos - points[0]);
    return straight <= crossed ? [cont(f, points[0]), cont(g, points[1])] : [cont(f, points[1]), cont(g, points[0])];
}
