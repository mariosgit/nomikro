// App registry: one entry per idea / version, shown in the header in this order.
// New app: copy src/apps/starter/ to src/apps/<name>/, rename the export, add it here. Route: #/<name>/...
import type { AppDef } from '../shell/types';
import { lab } from './lab';
import { starter } from './starter';

export const APPS = {
    lab,
    starter,
} satisfies Record<string, AppDef>;

export type AppName = keyof typeof APPS;
export const isAppName = (s: string): s is AppName => s in APPS;
export const DEFAULT_APP: AppName = 'lab';
