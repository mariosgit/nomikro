import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      // Hot-swapping modules would leave a stale HID handle and a running show loop behind.
      // A full reload re-runs the WebHID auto-connect, so every edit restarts the app on the device.
      name: 'full-reload-on-change',
      hotUpdate() {
        this.environment.hot.send({ type: 'full-reload' });
        return [];
      },
    },
  ],
  server: {
    port: 9000,
    open: true,
  },
});
