/**
 * Shared host HTML for every Hover React WebviewView.
 *
 * All views (dashboard / business-map) load the SAME bundled app
 * (dist/webview/webview.js + webview.css). The extension injects
 * which screen to render via `window.__HOVER_VIEW__`; the webview app's
 * top-level router (webview/App.tsx) switches on it. This is a param-driven
 * switch, not react-router — each WebviewView is a separate sandboxed iframe
 * with no shared URL/history. One bundle = one React runtime + shared code
 * once, instead of a per-view bundle.
 */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

/** Build the host page for a React webview, injecting `viewId` so the app's
 *  router renders the matching screen. */
export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  viewId: string,
): string {
  const nonce = randomBytes(16).toString('base64');
  const dist = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const js = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
  const css = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `connect-src ${webview.cspSource}`,
    `media-src ${webview.cspSource}`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${css}" />
</head><body>
<div id="root"></div>
<script nonce="${nonce}">window.__HOVER_VIEW__=${JSON.stringify(viewId)};</script>
<script type="module" nonce="${nonce}" src="${js}"></script>
</body></html>`;
}
