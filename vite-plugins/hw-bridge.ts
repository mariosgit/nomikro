/// <reference types="node" />
// Dev-only bridge between the browser app and the terminal (for testing with the device on camera):
//  - browser → file: `devlog(kind, data)` (src/devlog.ts) appends JSON lines to .devlog/hw.jsonl
//  - terminal → browser: `curl localhost:9000/__hw/run?mode=<mode>` switches the lab mode (src/apps/lab/modes/),
//    `?app=<app>[&path=…]` switches the app (src/apps/)
// The device itself is still driven only by the browser app over WebHID.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export function hwBridge(): Plugin {
    return {
        name: 'hw-bridge',
        apply: 'serve',
        configureServer(server) {
            const dir = resolve(server.config.root, '.devlog');
            const file = resolve(dir, 'hw.jsonl');
            mkdirSync(dir, { recursive: true });

            server.ws.on('hw:log', (data: unknown) => {
                appendFileSync(file, JSON.stringify(data) + '\n');
            });

            server.middlewares.use('/__hw/devlog', (_req, res) => {
                res.setHeader('Content-Type', 'text/plain');
                try {
                    res.end(readFileSync(file));
                } catch {
                    res.end('');
                }
            });

            server.middlewares.use('/__hw/run', (req, res) => {
                const params = Object.fromEntries(new URL(req.url ?? '', 'http://localhost').searchParams);
                if (!params.mode && !params.app) {
                    res.statusCode = 400;
                    res.end('usage: /__hw/run?mode=<lab mode>[&param=value...]  or  /__hw/run?app=<app>[&path=...][&param=value...]\n');
                    return;
                }
                server.ws.send('hw:run', params);
                res.end(`sent ${new URLSearchParams(params)} (lab modes confirm with a "mode" entry in .devlog/hw.jsonl)\n`);
            });
        },
    };
}
