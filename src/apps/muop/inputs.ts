// μOp audio inputs: USB audio of external synths (driven by MIDI out) mixed into the app. App page only.
// Settings belong to this computer (the devices), not to the song: localStorage. Each input has a level / mute,
// all inputs together have one more (the mixer's "Inputs" strip). Inputs reopen after unplug / replug.
import { listInputs, onInputsChange, openInput, requestInputPermission, type InputDevice, type OpenInput } from '../../engine/input';
import type { Sounds } from './sounds';

const KEY = 'muop-inputs';

export interface InputSetting {
    id: string;
    /** '' = not chosen yet. */
    deviceId: string;
    /** Last known device name (shown while it's missing). */
    label: string;
    level: number;
    mute: boolean;
}

export interface InputsSettings {
    /** The summed inputs (mixer strip). */
    level: number;
    mute: boolean;
    inputs: InputSetting[];
}

export type InputStatus = 'off' | 'opening' | 'on' | 'missing' | 'denied' | 'error';

interface Live {
    deviceId: string;
    open: OpenInput | null;
    strip: ReturnType<Sounds['connectInput']> | null;
    status: InputStatus;
    error: string;
}

function load(): InputsSettings {
    try {
        const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as InputsSettings | null;
        if (s && Array.isArray(s.inputs)) return { level: s.level ?? 1, mute: !!s.mute, inputs: s.inputs };
    } catch {
        // unreadable: start empty
    }
    return { level: 1, mute: false, inputs: [] };
}

export class Inputs {
    readonly settings = load();
    /** Audio inputs of this computer (labels empty until the permission was granted). */
    devices: InputDevice[] = [];
    private live = new Map<string, Live>();
    private offDevices: (() => void) | null = null;
    private disposed = false;

    constructor(
        private sounds: Sounds,
        private changed: () => void,
    ) {}

    /** Opens the configured inputs, follows devices coming and going. */
    async start(): Promise<void> {
        this.applyBus();
        this.offDevices = onInputsChange(() => void this.refresh());
        await this.refresh();
    }

    dispose(): void {
        this.disposed = true;
        this.offDevices?.();
        for (const id of [...this.live.keys()]) this.close(id);
    }

    status(id: string): { status: InputStatus; error: string } {
        const l = this.live.get(id);
        return { status: l?.status ?? 'off', error: l?.error ?? '' };
    }

    /** An input's level for its meter (per animation frame). */
    meter(id: string): number {
        return this.live.get(id)?.strip?.meter() ?? 0;
    }

    /** Error of the last add() (e.g. no permission), shown on the page. */
    addError = '';

    /** Adds an input (first device not used yet) and opens it: call from a click (the permission prompt). */
    async add(): Promise<void> {
        this.addError = '';
        if (!this.devices.length) {
            // no device ids before the permission: ask first
            try {
                await requestInputPermission();
                this.devices = await listInputs();
            } catch (error) {
                this.addError = (error as Error)?.name === 'NotAllowedError' ? 'No microphone permission (browser / system settings)' : String(error);
                return this.changed();
            }
        }
        const used = new Set(this.settings.inputs.map((i) => i.deviceId));
        const device = this.devices.find((d) => !used.has(d.id));
        const input: InputSetting = { id: Math.random().toString(36).slice(2, 8), deviceId: device?.id ?? '', label: device?.label ?? '', level: 1, mute: false };
        this.settings.inputs.push(input);
        this.save();
        void this.open(input);
    }

    remove(id: string): void {
        this.close(id);
        this.settings.inputs = this.settings.inputs.filter((i) => i.id !== id);
        this.save();
    }

    update(id: string, patch: Partial<Pick<InputSetting, 'deviceId' | 'level' | 'mute'>>): void {
        const input = this.settings.inputs.find((i) => i.id === id);
        if (!input) return;
        Object.assign(input, patch);
        input.level = Math.min(2, Math.max(0, input.level));
        if (patch.deviceId !== undefined) {
            input.label = this.devices.find((d) => d.id === input.deviceId)?.label ?? '';
            this.close(id);
            void this.open(input);
        }
        this.live.get(id)?.strip?.setLevel(input.mute ? 0 : input.level);
        this.save();
    }

    /** The summed inputs (mixer strip). */
    setBus(patch: Partial<Pick<InputsSettings, 'level' | 'mute'>>): void {
        Object.assign(this.settings, patch);
        this.settings.level = Math.min(1.5, Math.max(0, this.settings.level));
        this.applyBus();
        this.save();
    }

    /** Retry: e.g. after granting the permission. */
    retry(id: string): void {
        const input = this.settings.inputs.find((i) => i.id === id);
        if (!input) return;
        this.close(id);
        void this.open(input);
    }

    private applyBus(): void {
        this.sounds.setInputsLevel(this.settings.mute ? 0 : this.settings.level);
    }

    /** Re-reads the device list; opens inputs whose device is (back) there. */
    private async refresh(): Promise<void> {
        this.devices = await listInputs();
        if (this.disposed) return;
        for (const input of this.settings.inputs) {
            const l = this.live.get(input.id);
            const there = this.devices.some((d) => d.id === input.deviceId);
            if (!input.deviceId) continue;
            if (!there && l?.status !== 'denied') this.setStatus(input.id, 'missing');
            else if (there && (!l || l.status === 'missing' || l.status === 'off')) void this.open(input);
            // labels arrive after the permission
            const label = this.devices.find((d) => d.id === input.deviceId)?.label;
            if (label) input.label = label;
        }
        this.changed();
    }

    private async open(input: InputSetting): Promise<void> {
        if (!input.deviceId) return this.setStatus(input.id, 'off');
        const l: Live = { deviceId: input.deviceId, open: null, strip: null, status: 'opening', error: '' };
        this.live.set(input.id, l);
        this.changed();
        try {
            const open = await openInput(this.sounds.ctx, input.deviceId);
            if (this.disposed || this.live.get(input.id) !== l) return open.close(); // superseded
            l.open = open;
            l.strip = this.sounds.connectInput(open.node);
            l.strip.setLevel(input.mute ? 0 : input.level);
            l.status = 'on';
            if (open.label) input.label = open.label;
            open.onEnded(() => {
                this.close(input.id);
                this.setStatus(input.id, 'missing');
            });
            this.save();
            // the permission makes the device names visible
            void listInputs().then((d) => {
                this.devices = d;
                this.changed();
            });
        } catch (error) {
            const name = (error as Error)?.name;
            l.status = name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing' : 'error';
            l.error = String((error as Error)?.message ?? error);
        }
        this.changed();
    }

    private close(id: string): void {
        const l = this.live.get(id);
        if (!l) return;
        l.strip?.disconnect();
        l.open?.close();
        this.live.delete(id);
    }

    private setStatus(id: string, status: InputStatus): void {
        const l = this.live.get(id) ?? { deviceId: '', open: null, strip: null, status, error: '' };
        l.status = status;
        this.live.set(id, l);
        this.changed();
    }

    private save(): void {
        try {
            localStorage.setItem(KEY, JSON.stringify(this.settings));
        } catch {
            // blocked storage: settings live until the reload
        }
        this.changed();
    }
}
