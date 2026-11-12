import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hwBridge } from './vite-plugins/hw-bridge.ts';

export default defineConfig({
  plugins: [
    react(),
    hwBridge(),
    {
      // Hot-swapping modules would leave a stale HID handle and a running show loop behind.
      // A full reload re-runs the WebHID auto-connect, so every edit restarts the app on the device.
      name: 'full-reload-on-change',
      hotUpdate({ modules }) {
        if (modules.length === 0) return; // not part of the app (docs etc.)
        this.environment.hot.send({ type: 'full-reload' });
        return [];
      },
    },
  ],
  build: {
    rollupOptions: {
      // every page: the app + the examples
      input: {
        app: 'index.html',
        minimal: 'examples/minimal/index.html',
      },
    },
  },
  server: {
    port: 9000,
    open: true,
    watch: { ignored: ['**/.devlog/**'] },
  },
});
