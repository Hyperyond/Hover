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

/** A test account passed to a run so the agent can log in with it. */
export interface RunAccount {
  label: string;
  username?: string;
  password?: string;
  role?: string;
}

/** A credential to parameterize into a process.env reference on save. */
export interface Redaction {
  value: string;
  envVar: string;
}

/** A server→client message during/after a run ({type:'event'|'error'|'spec-saved'|'run-active'}). */
export interface ServerMessage {
  type: string;
  payload?: Record<string, unknown>;
}

export interface PoolHandlers {
  onRevealSource?: (source: string) => void;
  onStatus?: (connectedCount: number) => void;
  onModes?: (current: string | null, available: ModeEntry[]) => void;
  onAgents?: (current: string | null, available: AgentEntry[]) => void;
  /** Run lifecycle: streamed `event` payloads, plus `error` / `spec-saved`. */
  onServerMessage?: (msg: ServerMessage) => void;
}

export interface ServiceClientPool {
  /** Switch the active mode on every connected service (null = normal). */
  setMode(modeId: string | null): void;
  /** Switch the coding agent on every connected service. */
  switchAgent(agentId: string): void;
  /** Set the model (sonnet/opus/haiku/…) for subsequent runs. */
  setModel(model: string): void;
  /** Set (or clear) the model API key — held in memory by the service only. */
  setApiKey(key: string): void;
  /** Start a run (prompt) on the engine. `accounts` are the @-mentioned test
   *  accounts (with creds) the agent may log in with. Returns false if nothing
   *  is connected. */
  run(text: string, sessionId?: string, accounts?: RunAccount[], env?: { id?: string; name?: string }, sourceAccess?: 'always' | 'ask' | 'deny'): boolean;
  /** Reply to a source-read approval request from the engine's source MCP. */
  sendSourceApproval(approvalId: string, allow: boolean): void;
  /** Cancel the active run. */
  cancel(): void;
  /** Crystallize the accumulated steps into a spec. `redactions` parameterize
   *  credential fill values into process.env refs so secrets stay out of the spec. */
  saveSpec(name: string, steps: unknown[], redactions?: Redaction[]): boolean;
  /** Invoke a plugin-contributed save handler (e.g. `save:pentest:report`,
   *  `save:security:spec`). The engine replies with `<type>:saved` or `error`. */
  pluginSave(type: string, payload: Record<string, unknown>): boolean;
  /** Ask the engine to launch the isolated debug Chrome at `pageUrl`
   *  (headless = silent, no window). */
  launchChrome(pageUrl: string, headless: boolean, force?: boolean): boolean;
  /** Run the deterministic + LLM optimization pass on a saved spec. */
  optimizeSpec(slug: string): boolean;
  /** Re-record a spec: re-run its original prompt and overwrite the spec.
   *  `accounts` let the agent log in via @mentions; `redactions` keep those
   *  creds out of the rewritten spec. */
  reRecord(text: string, slug: string, accounts?: RunAccount[], redactions?: Redaction[], env?: { id?: string; name?: string }, sourceAccess?: 'always' | 'ask' | 'deny'): boolean;
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

  // The engine is a single service; the lowest-numbered open socket is it.
  const firstOpen = (): WebSocket | undefined => {
    for (const p of [...sockets.keys()].sort((a, b) => a - b)) {
      const s = sockets.get(p);
      if (s && s.readyState === WebSocket.OPEN) return s;
    }
    return undefined;
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
      } else if (
        msg.type === 'event' ||
        msg.type === 'error' ||
        msg.type === 'spec-saved' ||
        msg.type === 'run-active' ||
        msg.type === 'cdp-status' ||
        msg.type === 'optimize-result' ||
        msg.type === 'optimize-failed' ||
        msg.type === 'source-approval-request' ||
        (typeof msg.type === 'string' && msg.type.endsWith(':saved'))
      ) {
        handlers.onServerMessage?.(msg as ServerMessage);
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
    run(text: string, sessionId?: string, accounts?: RunAccount[], env?: { id?: string; name?: string }, sourceAccess?: 'always' | 'ask' | 'deny'): boolean {
      const ws = firstOpen();
      if (!ws) return false;
      ws.send(JSON.stringify({ type: 'command', payload: { text, sessionId, accounts, env, sourceAccess } }));
      return true;
    },
    sendSourceApproval(approvalId: string, allow: boolean): void {
      const ws = firstOpen();
      if (ws) ws.send(JSON.stringify({ type: 'source-approval-response', payload: { approvalId, allow } }));
    },
    cancel(): void {
      for (const ws of sockets.values()) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'cancel' }));
      }
    },
    saveSpec(name: string, steps: unknown[], redactions?: Redaction[]): boolean {
      const ws = firstOpen();
      if (!ws) return false;
      ws.send(JSON.stringify({ type: 'save-spec', payload: { name, steps, redactions } }));
      return true;
    },
    pluginSave(type: string, payload: Record<string, unknown>): boolean {
      const ws = firstOpen();
      if (!ws) return false;
      ws.send(JSON.stringify({ type, payload }));
      return true;
    },
    launchChrome(pageUrl: string, headless: boolean, force?: boolean): boolean {
      const ws = firstOpen();
      if (!ws) return false;
      ws.send(JSON.stringify({ type: 'launch-chrome', payload: { pageUrl, headless, force } }));
      return true;
    },
    optimizeSpec(slug: string): boolean {
      const ws = firstOpen();
      if (!ws) return false;
      ws.send(JSON.stringify({ type: 'optimize-spec', payload: { slug } }));
      return true;
    },
    reRecord(text: string, slug: string, accounts?: RunAccount[], redactions?: Redaction[], env?: { id?: string; name?: string }, sourceAccess?: 'always' | 'ask' | 'deny'): boolean {
      const ws = firstOpen();
      if (!ws) return false;
      ws.send(JSON.stringify({ type: 'command', payload: { text, reRecord: { slug }, accounts, redactions, env, sourceAccess } }));
      return true;
    },
    setModel(model: string): void {
      const body = JSON.stringify({ type: 'set-model', payload: { model } });
      for (const ws of sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(body);
    },
    setApiKey(key: string): void {
      const body = JSON.stringify({ type: 'set-api-key', payload: { key } });
      for (const ws of sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(body);
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
