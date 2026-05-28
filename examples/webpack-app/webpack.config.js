import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import { HoverPlugin } from 'webpack-plugin-hover';

// Minimal vanilla webpack 5 + plain JS — no React, no Babel, no TypeScript
// in the example. The point is to dogfood `webpack-plugin-hover` against
// the leanest possible host so the test signal is unambiguous.
const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  // webpack-cli passes `--mode` via argv; we set defaults so importing this
  // config from `node` for inspection still works.
  mode: 'development',
  // Quiet the per-build module dump — webpack-dev-server still prints
  // it on the first compile by default, which clutters the dev loop.
  // 'errors-warnings' keeps everything the user actually needs to see
  // (errors, hover service logs printed via console.info) and drops
  // the asset/module table.
  stats: 'errors-warnings',
  entry: resolve(__dirname, 'src/main.js'),
  output: {
    path: resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    clean: true,
  },
  devServer: {
    port: 5180,
    host: '127.0.0.1',
    // strictPort matches the other examples — fail fast if 5180 is busy
    // rather than silently picking another port.
    static: false,
  },
  plugins: [
    new HtmlWebpackPlugin({ template: resolve(__dirname, 'src/index.html') }),
    new HoverPlugin({ autoLaunchChrome: true }),
  ],
};
