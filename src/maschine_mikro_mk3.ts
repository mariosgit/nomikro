import { Buttons } from './buttons';
import { Pads } from './pads';
import { Lights } from './lights';
import { Screen } from './screen';
import settings from './maschine_mikro_mk3.json';

export interface PadEvent {
    cmd: string;
    pad_nb: number;
    pad_val: number;
    touched: boolean;
    pressed: boolean;
    released: boolean;
}

export class MaschineMikroMk3 {
    private hid: HIDDevice | null = null;
    public buttons: Buttons;
    public pads: Pads;
    public lights: Lights;
    public screen: Screen;

    private padsCallback: ((pad: PadEvent) => void) | null = null;

    constructor() {
        const vid = parseInt(settings.vid, 16);
        const pid = parseInt(settings.pid, 16);

        this.buttons = new Buttons(settings.button.order);
        this.pads = new Pads(settings.pad.order);
        this.lights = new Lights(settings, this);
        this.screen = new Screen(this);
    }

    public setPadCallback(callback: (pad: PadEvent) => void): void {
        this.padsCallback = callback;
    }

    private handleInputReport(event: HIDInputReportEvent): void {
        const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);

        const rawCmd = Array.from(bytes);
        let btn = this.buttons.decode(rawCmd); // first byte is 13
        if(btn) {
            console.log('Decoded button command:', btn.btn_pressed.join(', '));
        }
        let pad = this.pads.decode(rawCmd);  // first byte is 63
        if(pad) {
            // { "cmd": "pad", "pad_nb": 0-15, "pad_val": 0-4095, "touched": false, "pressed": true, "released": false }
            console.log('Decoded pad nb,val,tchd,prsd,rel:', pad.pad_nb, pad.pad_val, pad.touched, pad.pressed, pad.released);
            if (this.padsCallback) {
                this.padsCallback(pad);
            }
        }
    }

    async openDevice(device: HIDDevice): Promise<void> {
        this.hid = device;
        if (!this.hid.opened) await this.hid.open();
        this.hid.oninputreport = this.handleInputReport.bind(this);

        navigator.hid.addEventListener('disconnect', (event: HIDConnectionEvent) => {
            console.log(`HID disconnected: ${event.device.productName}`);
            console.dir(event);
        });
    }

    async write(data: number[]): Promise<void> {
        if (!this.hid) throw new Error('Device not connected');
        const bytes = new Uint8Array(data);
        const reportId = bytes[0];
        const reportData = bytes.slice(1);
        await this.hid.sendReport(reportId, reportData);
    }

}
