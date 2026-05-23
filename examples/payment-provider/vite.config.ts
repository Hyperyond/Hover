import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Note: NO vite-plugin-hover here — this app simulates a third-party
// payment provider that wouldn't have Hover installed in the real world.
// The widget should not appear on this origin.
export default defineConfig({
  plugins: [react()],
  server: { port: 5177, strictPort: true },
});
