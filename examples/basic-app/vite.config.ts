import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hover } from 'vite-plugin-hover';
import securityMode from '@hover-dev/security';
import pentestMode from '@hover-dev/pentest/plugin';

export default defineConfig({
  // Both modes loaded: orange security (authz → spec) + red pentest (offensive
  // → report). They share one resident MITM proxy and are mutually exclusive.
  plugins: [react(), hover({ autoLaunchChrome: true }, securityMode(), pentestMode())],
  server: { port: 5173, strictPort: true },
});
