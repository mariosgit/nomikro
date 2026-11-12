export interface PadEvent {
    cmd: string;
    /** Pad number 0..15, 0 = bottom left (printed "1"). */
    pad_nb: number;
    /** Pressure 0..4095. */
    pad_val: number;
    touched: boolean;
    pressed: boolean;
    released: boolean;
}

export class Pads {
    private padOrder: readonly number[];

    constructor(padOrder: readonly number[]) {
        this.padOrder = padOrder;
    }

    /**
     * Pad report (0x02, 63 data bytes) = up to 21 slots of 3 bytes: (hw slot, state<<4 | pressure hi, pressure lo).
     * Several pads changing at once arrive in one report. The list ends at the first all-zero slot after slot 0.
     */
    decode(rawCmd: ArrayLike<number>): PadEvent[] | null {
        if (rawCmd.length !== 63) {
            return null;
        }

        const events: PadEvent[] = [];
        for (let i = 0; i + 2 < rawCmd.length; i += 3) {
            const slot = rawCmd[i];
            const hi = rawCmd[i + 1];
            const lo = rawCmd[i + 2];
            if (i > 0 && slot === 0 && hi === 0 && lo === 0) break; // end of list
            if (slot >= this.padOrder.length) continue;

            const ctrl = hi & 0xF0;
            events.push({
                cmd: 'pad',
                pad_nb: this.padOrder[slot],
                pad_val: ((hi & 0x0F) << 8) + lo,
                touched: ctrl === 0x40,
                pressed: ctrl === 0x10,
                released: ctrl === 0x20 || ctrl === 0x30,
            });
        }
        return events;
    }
}
