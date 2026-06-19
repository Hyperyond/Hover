/**
 * Typed bridge to the VS Code webview host. `acquireVsCodeApi()` is injected by
 * VS Code into the webview's global scope exactly once, so we capture it here
 * and re-export a small typed surface. The message protocol is the SAME one the
 * extension already speaks (postMessage both ways) — React only changes the
 * rendering layer, not the wire format.
 */
interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}

// Inside VS Code, `acquireVsCodeApi` is injected. In a plain browser (the Vite
// dev server at :5174, used for HMR development) it doesn't exist — fall back to
// a console-logging stub so the app still renders and you can iterate on UI.
export const vscode: VsCodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : {
        postMessage: (m: unknown) => console.log("[webview:dev] postMessage", m),
        getState: () => undefined,
        setState: () => {},
      };

/** Send a message to the extension host. */
export function post(msg: Record<string, unknown>): void {
  vscode.postMessage(msg);
}

/** Subscribe to messages from the extension host. Returns an unsubscribe fn. */
export function onMessage(handler: (msg: { type?: string; [k: string]: unknown }) => void): () => void {
  const listener = (e: MessageEvent) => handler(e.data || {});
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
