import React, { useState, useEffect, useRef } from 'react';
import { MaschineMikroMk3 } from './maschine_mikro_mk3';
import settings from './maschine_mikro_mk3.json';
import { runLightShow } from './lightshow';

async function demoLights(maschine: MaschineMikroMk3): Promise<void> {
    const state = {
        button: {
            stop: { val: 2 },
        },
        strip: {
            1: { val: 3, color: 'blue' },
        },
        pad: {
            0: { val: 10, color: 'green' },
        },
    };
    maschine.lights.setAll(state);

    maschine.lights.set('pad', 6, 3, 'orange');
    maschine.lights.set('strip', 5, 3, 'green');

    maschine.lights.set('button', 'scene', 0);
    maschine.lights.set('button', 'pattern', 1);
    maschine.lights.set('button', 'events', 2);
    maschine.lights.set('button', 'variation', 3);
    maschine.lights.set('button', 'duplicate', 4);
    await maschine.lights.update();
}

async function demoScreen(maschine: MaschineMikroMk3): Promise<void> {
    await maschine.screen.set('Hello World!\nIt\'s working');
}

async function demoBtnPad(maschine: MaschineMikroMk3): Promise<void> {

    if (maschine) {
        maschine.setPadCallback((pad) => {
            console.log(`Pad callback: Pad ${pad.pad_nb} value ${pad.pad_val} touched ${pad.touched} pressed ${pad.pressed} released ${pad.released}`);
            maschine.lights.set('pad', pad.pad_nb, pad.pressed ? 3 : 0, 'red');
            maschine.lights.set('pad', pad.pad_nb, pad.released ? 3 : 0, 'green');
            maschine.lights.update();

            maschine.screen.set(`Pad ${pad.pad_nb}\nVal: ${pad.pad_val}\n`);
        });
    }

}

export function App() {
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState('');
    const [maschine, setMaschine] = useState<MaschineMikroMk3 | null>(null);
    const showRef = useRef<AbortController | null>(null);

    const vid = parseInt(settings.vid, 16);
    const pid = parseInt(settings.pid, 16);

    const startShow = (m: MaschineMikroMk3) => {
        showRef.current?.abort();
        const ctrl = new AbortController();
        showRef.current = ctrl;
        runLightShow(m, ctrl.signal).catch((error) => console.error('Light show failed:', error));
    };

    const stopShow = () => {
        showRef.current?.abort();
        showRef.current = null;
    };

    const connectDevice = async (device: HIDDevice) => {
        try {
            setStatus('Connecting Maschine Mikro MK3...');
            const newMaschine = new MaschineMikroMk3();
            await newMaschine.openDevice(device);
            setMaschine(newMaschine);
            setConnected(true);
            setStatus('Connected! Running light show...');

            demoBtnPad(newMaschine);
            startShow(newMaschine);
        } catch (error) {
            setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            console.error(error);
        }
    };

    useEffect(() => {
        const isMaschine = (device: HIDDevice) => device.vendorId === vid && device.productId === pid;

        const handleDeviceConnect = (event: HIDConnectionEvent) => {
            console.log('Device connected:', event.device.productName);
            if (isMaschine(event.device)) connectDevice(event.device);
        };

        const handleDeviceDisconnect = (event: HIDConnectionEvent) => {
            console.log('Device disconnected:', event.device.productName);
            if (isMaschine(event.device)) {
                stopShow();
                setConnected(false);
                setMaschine(null);
                setStatus('Device disconnected');
            }
        };

        navigator.hid.addEventListener('connect', handleDeviceConnect);
        navigator.hid.addEventListener('disconnect', handleDeviceDisconnect);

        // Auto-connect if permission was granted before (survives page reloads)
        navigator.hid.getDevices().then((devices) => {
            const device = devices.find(isMaschine);
            if (device) {
                console.log('Maschine Mikro MK3 already permitted, auto-connecting...');
                connectDevice(device);
            }
        });

        return () => {
            stopShow();
            navigator.hid.removeEventListener('connect', handleDeviceConnect);
            navigator.hid.removeEventListener('disconnect', handleDeviceDisconnect);
        };
    }, [vid, pid]);

    const handleConnect = async () => {
        try {
            const [device] = await navigator.hid.requestDevice({ filters: [{ vendorId: vid, productId: pid }] });
            if (device) await connectDevice(device);
        } catch (error) {
            setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            console.error(error);
        }
    };

    return (
        <div>
            <h1>Maschine Mikro MK3 - WebHID Demo</h1>
            <button onClick={handleConnect} disabled={connected}>
                {connected ? 'Connected' : 'Connect to Device'}
            </button>{' '}
            <button onClick={() => (showRef.current ? stopShow() : maschine && startShow(maschine))} disabled={!connected}>
                Start / stop light show
            </button>
            {status && <p>{status}</p>}
            <div id="output"></div>
        </div>
    );
}
