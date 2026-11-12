/** Dev only: appends {t, kind, data} as a JSON line to .devlog/hw.jsonl via the hw-bridge Vite plugin. */
export function devlog(kind: string, data?: unknown): void {
    import.meta.hot?.send('hw:log', { t: new Date().toISOString(), kind, data });
}

export const toHex = (bytes: ArrayLike<number>) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
