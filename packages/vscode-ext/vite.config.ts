import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Build config for the chat webview's React app (separate from the extension's
 * tsup CJS build — the webview runs in a browser context, not Node).
 *
 * Output goes to `dist/webview/` with stable filenames (`chat.js` / `chat.css`)
 * so the extension's loader can reference them by `webview.asWebviewUri` without
 * parsing a manifest. `base: './'` keeps asset URLs relative.
 *
 * Dev (HMR): `vite` serves `webview/` at http://localhost:5174; the extension
 * loads from there when HOVER_WEBVIEW_DEV is set, so edits hot-reload live.
 */
export default defineConfig({
  root: resolve(__dirname, "webview"),
  base: "./",
  plugins: [react()],
  // Allow importing the shared stylesheet from ../src (outside the webview root).
  server: { port: 5174, strictPort: true, fs: { allow: [".."] } },
  build: {
    outDir: resolve(__dirname, "dist/webview"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "webview/index.html"),
      output: {
        entryFileNames: "chat.js",
        chunkFileNames: "chat-[name].js",
        assetFileNames: (info) => (info.name?.endsWith(".css") ? "chat.css" : "[name][extname]"),
      },
    },
  },
});
