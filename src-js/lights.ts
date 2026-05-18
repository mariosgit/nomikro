import { MaschineMikroMk3 } from "./maschine_mikro_mk3";

export class Lights {
    private settings: any;
    private device: MaschineMikroMk3;
    private lightsState: any = {};

    constructor(settings: any, device: MaschineMikroMk3) {
        this.settings = settings;
        this.device = device;
    }

    setAll(state: any): void {
        this.lightsState = state;
    }

    getAll(): any {
        return this.lightsState;
    }

    set(elemType: string, elemRef: string | number, val: number = 4, color?: string): void {
        if (!(elemType in this.lightsState)) {
            this.lightsState[elemType] = {};
        }
        this.lightsState[elemType][elemRef] = { val, color };
    }

    private getElemNb(elemType: string, elemRef: string | number): number | null {
        if (elemType === 'pad' || elemType === 'button') {
            if (elemRef === 'enter') return null;
            return this.settings[elemType]['order'].indexOf(elemRef);
        }
        return typeof elemRef === 'number' ? elemRef : parseInt(elemRef as string);
    }

    private getColorByte(elemType: string, elem: any): number {
        let byte = 0x00;
        if (elemType === 'pad' || elemType === 'strip') {
            const colorNb = this.settings['color'].indexOf(elem.color);
            if (elem.val !== 0) {
                byte = 0x04 * colorNb + elem.val;
            }
        }
        if (elemType === 'button') {
            byte = this.settings['button']['brightness'][elem.val];
        }
        return byte;
    }

    private setColor(buf: number[], elemType: string, offset: number): void {
        if (!(elemType in this.lightsState)) return;

        for (const elemRef in this.lightsState[elemType]) {
            const elem = this.lightsState[elemType][elemRef];
            const elemNb = this.getElemNb(elemType, elemRef);
            if (elemNb !== null) {
                const byte = this.getColorByte(elemType, elem);
                buf[offset + elemNb] = byte;
            }
        }
    }

    async update(): Promise<void> {
        const buf = [0x80, ...new Array(90).fill(0x00)];

        this.setColor(buf, 'button', 1);
        this.setColor(buf, 'pad', 40);
        this.setColor(buf, 'strip', 56);

        await this.device.write(buf);
    }
}