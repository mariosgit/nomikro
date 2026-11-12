import React, { useState, useEffect, useRef } from 'react';
import { HID_FILTER, MaschineMikroMk3, isMaschineMikroMk3 as isMaschine } from '../maschine';
import { MODES, isModeName, type ModeName } from './modes';
import { devlog } from '../dev/devlog';

export function App() {
    const [status, setStatus] = useState('');
    const [maschine, setMaschine] = useState<MaschineMikroMk3 | null>(null);
    const [mode, setMode] = useState<{ name: ModeName; params: Record<string, string> }>({ name: 'show', params: {} });
    const [lines, setLines] = useState<string[]>([]);
    const running = useRef<Promise<void>>(Promise.resolve());

    const connectDevice = async (device: HIDDevice) => {
        try {
            setStatus('Connecting Maschine Mikro MK3...');
            const m = new MaschineMikroMk3();
            await m.openDevice(device);
            setMaschine(m);
            setStatus('Connected');
            devlog('connected');
        } catch (error) {
            setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            console.error(error);
        }
    };

    // Device connect / disconnect, auto-connect if permission was granted before (survives page reloads)
    useEffect(() => {
        const onConnect = (event: HIDConnectionEvent) => {
            if (isMaschine(event.device)) connectDevice(event.device);
        };
        const onDisconnect = (event: HIDConnectionEvent) => {
            if (isMaschine(event.device)) {
                setMaschine(null);
                setStatus('Device disconnected');
                devlog('disconnected');
            }
        };
        navigator.hid.addEventListener('connect', onConnect);
        navigator.hid.addEventListener('disconnect', onDisconnect);
        navigator.hid.getDevices().then((devices) => {
            const device = devices.find(isMaschine);
            if (device) connectDevice(device);
        });
        return () => {
            navigator.hid.removeEventListener('connect', onConnect);
            navigator.hid.removeEventListener('disconnect', onDisconnect);
        };
    }, []);

    // Mode switching from the terminal: curl 'localhost:9000/__hw/run?mode=<mode>&<params>'
    useEffect(() => {
        const hot = import.meta.hot;
        if (!hot) return;
        const onRun = ({ mode: name, ...params }: Record<string, string>) => {
            if (isModeName(name)) setMode({ name, params });
            else devlog('error', `unknown mode "${name}", known: ${Object.keys(MODES).join(', ')}`);
        };
        hot.on('hw:run', onRun);
        return () => hot.off('hw:run', onRun);
    }, []);

    // Run the current mode. Modes run strictly one after another, so a mode's cleanup can't wipe the next one.
    useEffect(() => {
        if (!maschine) return;
        const ctrl = new AbortController();
        setLines([]);
        const log = (line: string, data?: unknown) => {
            setLines((prev) => [line, ...prev].slice(0, 30));
            devlog('event', { mode: mode.name, line, data });
        };
        const previous = running.current;
        running.current = (async () => {
            await previous;
            if (ctrl.signal.aborted) return;
            devlog('mode', { mode: mode.name, params: mode.params });
            await MODES[mode.name].run(maschine, ctrl.signal, { params: mode.params, log });
        })().catch((error) => {
            console.error(`Mode ${mode.name} failed:`, error);
            devlog('error', { mode: mode.name, error: String(error) });
        });
        return () => ctrl.abort();
    }, [maschine, mode]);

    const handleConnect = async () => {
        try {
            const [device] = await navigator.hid.requestDevice({ filters: [HID_FILTER] });
            if (device) await connectDevice(device);
        } catch (error) {
            setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            console.error(error);
        }
    };

    return (
        <div>
            <h1>Maschine Mikro MK3 - WebHID Demo</h1>
            <button onClick={handleConnect} disabled={!!maschine}>
                {maschine ? 'Connected' : 'Connect to Device'}
            </button>
            {status && <p>{status}</p>}

            <p>
                {(Object.keys(MODES) as ModeName[]).map((name) => (
                    <button
                        key={name}
                        onClick={() => setMode({ name, params: {} })}
                        disabled={!maschine}
                        style={{ marginRight: 4, fontWeight: name === mode.name ? 'bold' : undefined }}
                    >
                        {MODES[name].label}
                    </button>
                ))}
            </p>
            <p>
                <b>{MODES[mode.name].label}</b>: {MODES[mode.name].help}
            </p>
            <pre>{lines.join('\n')}</pre>
        </div>
    );
}
