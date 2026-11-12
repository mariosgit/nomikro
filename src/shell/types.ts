// App contract: one idea = one app = one folder in src/apps/<name>/ + one entry in src/apps/index.ts.
import type { ComponentType } from 'react';
import type { MaschineMikroMk3 } from '../maschine';

export interface AppProps {
    /** The connected device, null while disconnected. Drive it with useDeviceTask() (./device.ts). */
    maschine: MaschineMikroMk3 | null;
    /** Route below the app: #/<app>/<path>?<params> */
    path: string;
    params: Record<string, string>;
    /** Navigate inside this app. The same route again re-mounts nothing but bumps `routeKey` (re-run). */
    navigate(path: string, params?: Record<string, string>): void;
    /** Changes on every navigation, even to the same route (lets an app re-run what it shows). */
    routeKey: number;
}

export interface AppDef {
    /** Short tab name in the header. */
    label: string;
    /** Long name, shown instead of the label on the selected tab (default: the label). */
    title?: string;
    description: string;
    Component: ComponentType<AppProps>;
    /**
     * Terminal control via the hw-bridge: `curl 'localhost:9000/__hw/run?app=<name>&<params>'`.
     * Map the bridge params to a route below the app (default: path = params.path).
     */
    bridge?(params: Record<string, string>): { path: string; params: Record<string, string> };
}
