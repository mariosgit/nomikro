export class Pads {
    private padOrder: number[];

    constructor(padOrder: number[]) {
        this.padOrder = padOrder;
    }

    decode(rawCmd: number[]): { cmd: string;[key: string]: any } | null {
        if (rawCmd.length !== 63) {
            return null;
        }

        // console.log('Decoding pad command from raw data:', rawCmd);

        const info: any = {};
        info.cmd = 'pad';
        info.pad_nb = this.padOrder[rawCmd[0]];
        info.pad_val = ((rawCmd[1] & 0x0F) << 8) + rawCmd[2];

        const ctrl = rawCmd[1] & 0xF0;
        info.touched = ctrl === 0x40;
        info.pressed = ctrl === 0x10;
        info.released = ctrl === 0x20 || ctrl === 0x30;

        return info;
    }
}
