import { Buttons, type ButtonState } from './buttons';
import { Pads, type PadEvent } from './pads';
import { Lights } from './lights';
import { Screen } from './screen';
import { BUTTONS, PAD_ORDER } from './hardware';

/** Output priority: lights jump ahead of queued screen reports. */
export const Priority = { Lights: 0, Screen: 1 } as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

interface QueuedReport {
    priority: Priority;
    reportId: number;
    data: Uint8Array<ArrayBuffer>;
    resolve: () => void;
    reject: (error: unknown) => void;
}

export class MaschineMikroMk3 {
    private hid: HIDDevice | null = null;
    public buttons: Buttons;
    public pads: Pads;
    public lights: Lights;
    public screen: Screen;

    private padsCallback: ((pad: PadEvent) => void) | null = null;
    private buttonsCallback: ((state: ButtonState) => void) | null = null;

    // All output goes through one queue, one report on the wire at a time (measured: lights ≈ 16 ms,
    // one screen half ≈ 38 ms). Lights go first, so they wait at most for the screen half in flight.
    private queue: QueuedReport[] = [];
    private writing = false;

    constructor() {
        this.buttons = new Buttons(BUTTONS);
        this.pads = new Pads(PAD_ORDER);
        this.lights = new Lights((id, data) => this.sendReport(id, data, Priority.Lights));
        this.screen = new Screen((id, data) => this.sendReport(id, data, Priority.Screen));
    }

    public setPadCallback(callback: (pad: PadEvent) => void): void {
        this.padsCallback = callback;
    }

    /** Called for every button report: pressed buttons, encoder, touch strip. */
    public setButtonCallback(callback: ((state: ButtonState) => void) | null): void {
        this.buttonsCallback = callback;
    }

    /** Optional raw input hook (report id + data bytes), e.g. for the input monitor. */
    public onRawInput: ((reportId: number, bytes: Uint8Array) => void) | null = null;

    private handleInputReport(event: HIDInputReportEvent): void {
        this.injectInput(event.reportId, new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength));
    }

    /** Processes one input report as if it came from the device (also used to replay recorded input). */
    injectInput(reportId: number, bytes: Uint8Array): void {
        this.onRawInput?.(reportId, bytes);

        const btn = this.buttons.decode(bytes); // 13 bytes
        if (btn) this.buttonsCallback?.(btn);

        const pads = this.pads.decode(bytes); // 63 bytes, one event per changed pad
        for (const pad of pads ?? []) {
            this.padsCallback?.(pad);
        }
    }

    async openDevice(device: HIDDevice): Promise<void> {
        this.hid = device;
        if (!this.hid.opened) await this.hid.open();
        this.hid.oninputreport = this.handleInputReport.bind(this);
        // Disconnects are handled by the app (navigator.hid 'disconnect'); no listener here, it leaked one per connect.
    }

    /** Optional hook after each output report: wire time in ms, error if it failed (for tests/diagnostics). */
    public onWrite: ((reportId: number, size: number, ms: number, error?: unknown) => void) | null = null;

    get device(): HIDDevice | null {
        return this.hid;
    }

    /** Queues an output report. Resolves when it was written. */
    sendReport(reportId: number, data: Uint8Array<ArrayBuffer>, priority: Priority = Priority.Lights): Promise<void> {
        return new Promise((resolve, reject) => {
            this.queue.push({ priority, reportId, data, resolve, reject });
            this.drain();
        });
    }

    private async drain(): Promise<void> {
        if (this.writing) return;
        this.writing = true;
        try {
            while (this.queue.length) {
                // highest priority first, FIFO within a priority
                let next = 0;
                for (let i = 1; i < this.queue.length; i++) if (this.queue[i].priority < this.queue[next].priority) next = i;
                const job = this.queue.splice(next, 1)[0];

                const t0 = performance.now();
                try {
                    if (!this.hid) throw new Error('Device not connected');
                    await this.hid.sendReport(job.reportId, job.data);
                    this.onWrite?.(job.reportId, job.data.byteLength, performance.now() - t0);
                    job.resolve();
                } catch (error) {
                    this.onWrite?.(job.reportId, job.data.byteLength, performance.now() - t0, error);
                    job.reject(error);
                }
            }
        } finally {
            this.writing = false;
        }
    }
}
