/**
 * Editor-side client to the Hover core WebSocket service(s).
 *
 * The core service binds 127.0.0.1 starting at 51789, auto-bumping to 51798
 * when several examples run at once. We don't know which port the user's dev
 * server bound, so we keep a socket to every port in the range and reconnect on
 * drop (Vite HMR tears connections down constantly). `ws` is bundled into the
 * extension by tsup.
 *
 * It carries three things for the extension UI:
 *   • `reveal-source` relays (F2 page→editor: Alt+click in the widget),
 *   • connection status (for the status-bar indicator),
 *   • mode state (`modes` broadcast) + `set-mode` (the testing / security /
 *     pentest switch — one extension, the engine's existing mode protocol).
 */
import WebSocket from 'ws';

const HOST = '127.0.0.1';
const PORT_START = 51789;
const PORT_END = 51798;
const RECONNECT_MS = 4000;

export interface ModeEntry {
  id: string;
  label: string;
  description?: string;
  accent?: string;
  pluginName?: string;
}

export interface AgentEntry {
  id: string;
  installed?: boolean;
}

export interface PoolHandlers {
  onRevealSource?: (source: string) => void;
  onStatus?: (connectedCount: number) => void;
  onModes?: (current: string | null, available: ModeEntry[]) => void;
  onAgents?: (current: string | null, available: AgentEntry[]) => void;
}

export interface ServiceClientPool {
  /** Switch the active mode on every connected service (null = normal). */
  setMode(modeId: string | null): void;
  /** Switch the coding agent on every connected service. */
  switchAgent(agentId: string): void;
  dispose(): void;
}

export function connectServicePool(handlers: PoolHandlers): ServiceClientPool {
  const sockets = new Map<number, WebSocket>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let disposed = false;

  const reportStatus = (): void => {
    if (disposed || !handlers.onStatus) return;
    let open = 0;
    for (const s of sockets.values()) if (s.readyState === WebSocket.OPEN) open++;
    handlers.onStatus(open);
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
      let msg: { type?: unknown; payload?: { source?: unknown; current?: unknown; available?: unknown } };
      try {
        msg = JSON.parse(data.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === 'reveal-source' && typeof msg.payload?.source === 'string' && msg.payload.source) {
        handlers.onRevealSource?.(msg.payload.source);
      } else if (msg.type === 'modes' && handlers.onModes) {
        const current = typeof msg.payload?.current === 'string' ? msg.payload.current : null;
        const available = Array.isArray(msg.payload?.available) ? (msg.payload!.available as ModeEntry[]) : [];
        handlers.onModes(current, available);
      } else if (msg.type === 'agents' && handlers.onAgents) {
        const current = typeof msg.payload?.current === 'string' ? msg.payload.current : null;
        const available = Array.isArray(msg.payload?.available) ? (msg.payload!.available as AgentEntry[]) : [];
        handlers.onAgents(current, available);
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
    setMode(modeId: string | null): void {
      const body = JSON.stringify({ type: 'set-mode', payload: { modeId } });
      for (const ws of sockets.values()) {
        if (ws.readyState === WebSocket.OPEN) ws.send(body);
      }
    },
    switchAgent(agentId: string): void {
      const body = JSON.stringify({ type: 'switch-agent', payload: { agentId } });
      for (const ws of sockets.values()) {
        if (ws.readyState === WebSocket.OPEN) ws.send(body);
      }
    },
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
