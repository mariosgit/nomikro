import { Buttons } from './buttons';
import { Pads } from './pads';
import { Lights } from './lights';
import { Screen } from './screen';
import settings from './maschine_mikro_mk3.json';

export class MaschineMikroMk3 {
    private hid: HIDDevice | null = null;
    public buttons: Buttons;
    public pads: Pads;
    public lights: Lights;
    public screen: Screen;

    constructor() {
        const vid = parseInt(settings.vid, 16);
        const pid = parseInt(settings.pid, 16);

        this.buttons = new Buttons(settings.button.order);
        this.pads = new Pads(settings.pad.order);
        this.lights = new Lights(settings, this);
        this.screen = new Screen(this);
    }

    private handleInputReport(event: HIDInputReportEvent): void {
        const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);

        const rawCmd = Array.from(bytes);
        let btn = this.buttons.decode(rawCmd); // first byte is 13
        if(btn) {
            console.log('Decoded button command:', btn.btn_pressed.join(', '));
        }
        let cmd = this.pads.decode(rawCmd);  // first byte is 63
        if(cmd) {
            // { "cmd": "pad", "pad_nb": 0-15, "pad_val": 0-4095, "touched": false, "pressed": true, "released": false }
            console.log('Decoded pad nb,val,tchd,prsd,rel:', cmd.pad_nb, cmd.pad_val, cmd.touched, cmd.pressed, cmd.released);
        }
    }

    // async connect(): Promise<void> {
    //     await this.hid.connect();

    //     this.hid.setInputCallback((rawCmd) => {
    //         console.log('Received raw command:', rawCmd);
    //         let cmd = this.buttons.decode(rawCmd);
    //         if (cmd) {
    //             console.log('Decoded button command:', cmd);
    //             return;
    //         }
    //         cmd = this.pads.decode(rawCmd);
    //         if (cmd) {
    //             console.log('Decoded pad command:', cmd);
    //         }
    //     });
    // }

    async openDevice(device: HIDDevice): Promise<void> {
        this.hid = device;
        await this.hid.open();
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

    readCmd(): Promise<{ cmd: string; [key: string]: any } | null> {
        return new Promise((resolve, reject) => {
            // this.hid.setInputCallback((rawCmd) => {
            //     let cmd = this.buttons.decode(rawCmd);
            //     if (cmd) {
            //         resolve(cmd);
            //         return;
            //     }
            //     cmd = this.pads.decode(rawCmd);
            //     resolve(cmd);
            // });
            reject(new Error('readCmd() not implemented yet'));
        });
    }
}