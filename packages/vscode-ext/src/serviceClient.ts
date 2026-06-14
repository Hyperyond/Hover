/**
 * F2 page→editor transport (editor side).
 *
 * The Hover core service runs a WebSocket server bound to 127.0.0.1, starting
 * at port 51789 and auto-bumping up to 51798 when several examples run at once
 * (see `@hover-dev/core`'s service). The in-page widget connects to its own
 * service and, when the user clicks an element carrying `data-hover-source`,
 * sends `{ type: 'reveal-source', payload: { source } }`. The service relays
 * that to every OTHER connected client — so this extension connects as a client
 * and, on `reveal-source`, jumps the editor to the location.
 *
 * We don't know which port the user's dev server bound, so we keep a socket to
 * every port in the range and reconnect on drop (Vite HMR tears connections
 * down constantly). `ws` is bundled into the extension by tsup.
 */
import WebSocket from 'ws';

const HOST = '127.0.0.1';
const PORT_START = 51789;
const PORT_END = 51798;
const RECONNECT_MS = 4000;

export interface ServiceClientPool {
  dispose(): void;
}

/**
 * Connect to every Hover service port in the range and invoke `onRevealSource`
 * whenever any of them relays a `reveal-source` message. Returns a handle that
 * tears every socket down.
 */
export function connectServicePool(
  onRevealSource: (source: string) => void,
  onStatus?: (connectedCount: number) => void,
): ServiceClientPool {
  const sockets = new Map<number, WebSocket>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let disposed = false;

  const reportStatus = (): void => {
    if (disposed || !onStatus) return;
    let open = 0;
    for (const s of sockets.values()) if (s.readyState === WebSocket.OPEN) open++;
    onStatus(open);
  };

  const connect = (port: number): void => {
    if (disposed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${HOST}:${port}`);
    } catch {
      scheduleReconnect(port);
      return;
    }
    sockets.set(port, ws);

    ws.on('open', () => reportStatus());

    ws.on('message', (data: WebSocket.RawData) => {
      let msg: { type?: unknown; payload?: { source?: unknown } };
      try {
        msg = JSON.parse(data.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === 'reveal-source' && typeof msg.payload?.source === 'string' && msg.payload.source) {
        onRevealSource(msg.payload.source);
      }
    });

    // A refused/closed/errored port just gets retried later — most ports in the
    // range have no service, so errors are expected and silent.
    ws.on('error', () => {});
    ws.on('close', () => {
      sockets.delete(port);
      reportStatus();
      scheduleReconnect(port);
    });
  };

  const scheduleReconnect = (port: number): void => {
    if (disposed || timers.has(port)) return;
    const t = setTimeout(() => {
      timers.delete(port);
      connect(port);
    }, RECONNECT_MS);
    timers.set(port, t);
  };

  for (let port = PORT_START; port <= PORT_END; port++) connect(port);

  return {
    dispose(): void {
      disposed = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const ws of sockets.values()) {
        try {
          ws.removeAllListeners();
          ws.close();
        } catch {
          /* already closed */
        }
      }
      sockets.clear();
    },
  };
}
