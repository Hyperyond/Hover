import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hover } from 'vite-plugin-hover';

// React Native Web compiled into a plain DOM SPA via Vite. The single
// load-bearing piece is the `react-native` → `react-native-web` alias —
// once that's in place, RN components (View / Text / TextInput / Pressable)
// render to actual DOM nodes, so Hover's Shadow-DOM widget + Playwright
// MCP semantic-selector strategy work exactly the same as in any other
// Vite + React example.
//
// What this DOES NOT cover: native React Native targets (iOS .ipa /
// Android .apk / Expo Go). Those have no DOM and no Chrome DevTools
// Protocol — out of Hover's scope. See the project README for the
// honest framing on RN coverage.
export default defineConfig({
  plugins: [react(), hover({ autoLaunchChrome: true })],
  resolve: {
    alias: { 'react-native': 'react-native-web' },
  },
  server: { port: 5181, strictPort: true },
});
