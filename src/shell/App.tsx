// The shell: device connection, header (app switcher, status), routing. Apps live in src/apps/.
import React, { useState, useEffect } from 'react';
import { HID_FILTER, MaschineMikroMk3, isMaschineMikroMk3 as isMaschine } from '../maschine';
import { APPS, DEFAULT_APP, isAppName, type AppName } from '../apps';
import { devlog } from '../dev/devlog';
import { parseHash, toHash, type Route } from './route';

const APP_NAMES = Object.keys(APPS) as AppName[];

type Status = { kind: 'idle' | 'busy' | 'ok' | 'error'; text: string };

/** Current route, with an unknown app replaced by the default one. */
const currentRoute = (): Route => {
    const route = parseHash(location.hash);
    return isAppName(route.app) ? route : { app: DEFAULT_APP, path: '', params: {} };
};

export function App() {
    const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'Not connected' });
    const [maschine, setMaschine] = useState<MaschineMikroMk3 | null>(null);
    const [route, setRoute] = useState(currentRoute);
    const [routeKey, setRouteKey] = useState(0);

    /** Navigate via the URL. The same route again bumps routeKey, so the app can re-run it. */
    const navigate = (to: Route) => {
        const hash = toHash(to);
        if (hash === location.hash) setRouteKey((k) => k + 1);
        else location.hash = hash;
    };

    // Route changes (header, app navigation, back/forward, typed URL)
    useEffect(() => {
        const onHashChange = () => {
            setRoute(currentRoute());
            setRouteKey((k) => k + 1);
        };
        if (location.hash !== toHash(route)) history.replaceState(null, '', toHash(route));
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);

    const connectDevice = async (device: HIDDevice) => {
        try {
            setStatus({ kind: 'busy', text: 'Connecting…' });
            const m = new MaschineMikroMk3();
            await m.openDevice(device);
            setMaschine(m);
            setStatus({ kind: 'ok', text: 'Connected' });
            devlog('connected');
        } catch (error) {
            setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Unknown error' });
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
                setStatus({ kind: 'idle', text: 'Disconnected' });
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

    // Terminal control: curl 'localhost:9000/__hw/run?[app=<app>&]<params>' (no app = lab, e.g. mode=stress)
    useEffect(() => {
        const hot = import.meta.hot;
        if (!hot) return;
        const onRun = ({ app = 'lab', ...params }: Record<string, string>) => {
            if (!isAppName(app)) {
                devlog('error', `unknown app "${app}", known: ${APP_NAMES.join(', ')}`);
                return;
            }
            const def = APPS[app];
            const { path: p = '', ...rest } = params;
            const target = 'bridge' in def && def.bridge ? def.bridge(params) : { path: p, params: rest };
            navigate({ app, ...target });
        };
        hot.on('hw:run', onRun);
        return () => hot.off('hw:run', onRun);
    }, []);

    const handleConnect = async () => {
        try {
            const [device] = await navigator.hid.requestDevice({ filters: [HID_FILTER] });
            if (device) await connectDevice(device);
        } catch (error) {
            setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Unknown error' });
            console.error(error);
        }
    };

    const appName = route.app as AppName;
    const { Component } = APPS[appName];

    return (
        <div className="min-h-screen">
            <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
                    <a href={toHash({ app: DEFAULT_APP, path: '', params: {} })} className="flex items-baseline gap-2">
                        <span className="text-lg font-bold tracking-tight" title="nomikro">
                            noμ
                        </span>
                    </a>

                    <nav className="flex flex-1 flex-wrap items-center gap-1" aria-label="Apps">
                        {APP_NAMES.map((name) => (
                            <a
                                key={name}
                                href={toHash({ app: name, path: '', params: {} })}
                                title={APPS[name].description}
                                aria-current={name === appName ? 'page' : undefined}
                                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                                    name === appName
                                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                                        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white'
                                }`}
                            >
                                {APPS[name].label}
                            </a>
                        ))}
                    </nav>

                    <div className="flex items-center gap-3">
                        <StatusBadge status={status} />
                        {!maschine && (
                            <button
                                onClick={handleConnect}
                                className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-orange-600 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-offset-zinc-900"
                            >
                                Connect
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
                {!maschine && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                        Connect the device to play. WebHID needs Chrome or Chromium.
                    </p>
                )}
                {/* key: switching apps unmounts the old one, which aborts its device task */}
                <Component
                    key={appName}
                    maschine={maschine}
                    path={route.path}
                    params={route.params}
                    routeKey={routeKey}
                    navigate={(path, params = {}) => navigate({ app: appName, path, params })}
                />
            </main>
        </div>
    );
}

const STATUS_DOT: Record<Status['kind'], string> = {
    idle: 'bg-zinc-400',
    busy: 'bg-amber-400 animate-pulse',
    ok: 'bg-emerald-500',
    error: 'bg-red-500',
};

function StatusBadge({ status }: { status: Status }) {
    return (
        <span
            className={`inline-flex max-w-xs items-center gap-2 truncate text-sm ${
                status.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-300'
            }`}
            title={status.text}
        >
            <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[status.kind]}`} />
            {status.text}
        </span>
    );
}
