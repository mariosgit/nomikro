import React, { useState, useEffect } from 'react';
import { MaschineMikroMk3 } from './maschine_mikro_mk3';
import settings from './maschine_mikro_mk3.json';

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

    const vid = parseInt(settings.vid, 16);
    const pid = parseInt(settings.pid, 16);

    useEffect(() => {
        const handleDeviceConnect = async (event: HIDConnectionEvent) => {
            console.log('Device connected:', event.device.productName);
            if (event.device.vendorId === vid && event.device.productId === pid) {
                console.log('Maschine Mikro MK3 detected! Auto-connecting...');
                try {
                    setStatus('Auto-connecting Maschine Mikro MK3...');
                    const newMaschine = new MaschineMikroMk3();
                    console.log(event.device);
                    await newMaschine.openDevice(event.device);
                    setMaschine(newMaschine);
                    setConnected(true);
                    setStatus('Connected! Running demo...');

                    demoLights(newMaschine);
                    demoScreen(newMaschine);
                    demoBtnPad(newMaschine);

                } catch (error) {
                    setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    console.error(error);
                }
            }
        };

        const handleDeviceDisconnect = (event: HIDConnectionEvent) => {
            console.log('Device disconnected:', event.device.productName);
            if (event.device.vendorId === vid && event.device.productId === pid) {
                console.log('Maschine Mikro MK3 disconnected');
                setConnected(false);
                setMaschine(null);
                setStatus('Device disconnected');
            }
        };

        navigator.hid.addEventListener('connect', handleDeviceConnect);
        navigator.hid.addEventListener('disconnect', handleDeviceDisconnect);

        if (maschine && connected) {
            // console.log('Device already connected, running demo...');
            // demoLights(maschine);
            // demoScreen(maschine);
            // demoBtnPad(maschine);
        } else {
            navigator.hid.getDevices().then(async (devices) => {
                console.log('Checking for already connected devices...', devices);
                const maschineDevice = devices.find(
                    (device) => device.vendorId === vid && device.productId === pid
                );
                if (maschineDevice) {
                    console.log('Maschine Mikro MK3 already connected! Auto-connecting...');
                    await handleDeviceConnect({ device: maschineDevice } as HIDConnectionEvent);
                }
            });
        }


        return () => {
            navigator.hid.removeEventListener('connect', handleDeviceConnect);
            navigator.hid.removeEventListener('disconnect', handleDeviceDisconnect);
        };
    }, [vid, pid]);

    const handleConnect = async () => {
        try {
            // setStatus('Connecting...');
            // const newMaschine = new MaschineMikroMk3();
            // await newMaschine.connect();
            // setMaschine(newMaschine);
            // setConnected(true);
            // setStatus('Connected! Running demo...');

            // await demoLights(newMaschine);
            // await demoScreen(newMaschine);
            // await demoBtnPad(newMaschine);
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
            </button>
            {status && <p>{status}</p>}
            <div id="output"></div>
        </div>
    );
}
