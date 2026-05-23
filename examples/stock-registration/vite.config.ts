import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hover } from 'vite-plugin-hover';

export default defineConfig({
  plugins: [react(), hover({ autoLaunchChrome: true })],
  server: { port: 5175, strictPort: true },
});
