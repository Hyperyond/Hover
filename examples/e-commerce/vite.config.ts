import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hover } from '@hover/vite-plugin';

export default defineConfig({
  plugins: [react(), hover()],
  server: { port: 5174, strictPort: true },
});
