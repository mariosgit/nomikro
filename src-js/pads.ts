import { PadEvent } from "./maschine_mikro_mk3";

export class Pads {
    private padOrder: number[];

    constructor(padOrder: number[]) {
        this.padOrder = padOrder;
    }

    decode(rawCmd: number[]): PadEvent | null {
        if (rawCmd.length !== 63) {
            return null;
        }

        // console.log('Decoding pad command from raw data:', rawCmd);

        const info: PadEvent = {
            cmd: 'pad',
            pad_nb: 0,
            pad_val: 0,
            touched: false,
            pressed: false,
            released: false
        };

        info.pad_nb = this.padOrder[rawCmd[0]];
        info.pad_val = ((rawCmd[1] & 0x0F) << 8) + rawCmd[2];

        const ctrl = rawCmd[1] & 0xF0;
        info.touched = ctrl === 0x40;
        info.pressed = ctrl === 0x10;
        info.released = ctrl === 0x20 || ctrl === 0x30;

        return info;
    }
}
