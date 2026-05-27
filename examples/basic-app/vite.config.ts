import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hover } from 'vite-plugin-hover';
import securityMode from '@hover-dev/security';

export default defineConfig({
  plugins: [react(), hover({ autoLaunchChrome: true }, securityMode())],
  server: { port: 5173, strictPort: true },
});
