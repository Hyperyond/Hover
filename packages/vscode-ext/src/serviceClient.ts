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

/** A BYOK model config pushed to the engine via `set-byok`. The protocol
 *  selects the CLI + auth env vars; key/base/model are injected at run time. */
export interface ByokConfig {
  protocol: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  apiKey: string;
}

export interface AgentEntry {
  id: string;
  installed?: boolean;
  /** Rich availability fields the engine already sends in the `agents`
   *  payload (from core's listAgentAvailability) — used by the Settings
   *  "Local CLI" panel to render detected + installable agents. */
  label?: string;
  tagline?: string;
  sandboxStrength?: 'hard' | 'soft';
  binPath?: string;
  homepage?: string;
  installHint?: string;
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
  onModes?: (current: string | null, available: ModeEntry[], caps?: { api: boolean; pentest: boolean }) => void;
  onAgents?: (current: string | null, available: AgentEntry[]) => void;
  /** Run lifecycle: streamed `event` payloads, plus `error` / `spec-saved`.
   *  `enginePort` is the host the message came from, so the extension can route
   *  it to the chat session driving that host (multi-host model). */
  onServerMessage?: (msg: ServerMessage, enginePort: number) => void;
  /** Captured MITM flows from the security runtime (security:flow:added /
   *  :updated / security:flows:cleared) — feeds the Network view. */
  onFlow?: (msg: ServerMessage) => void;
}

export interface ServiceClientPool {
  /** Switch the active mode on every connected service (null = normal). */
  setMode(modeId: string | null): void;
  /** Switch the coding agent on every connected service. */
  switchAgent(agentId: string): void;
  /** Set the model (sonnet/opus/haiku/…) for subsequent runs. */
  setModel(model: string): void;
  /** Set the reasoning-effort level for subsequent runs ('' clears it). */
  setEffort(effort: string): void;
  /** Set the Local LLM endpoint base URL ('' clears it) for the qwen host. */
  setLocalEndpoint(baseUrl: string): void;
  /** Set the BYOK config for subsequent runs — protocol + key + base URL +
   *  model are injected into the protocol's matching CLI. null clears it
   *  (fall back to the local-CLI agent's own auth). */
  setByok(config: ByokConfig | null): void;
  /** Force the engine to re-scan PATH for installed CLIs and re-broadcast the
   *  agent availability list. */
  refreshAgents(): void;
  /** Start a run (prompt) on the engine. `accounts` are the @-mentioned test
   *  accounts (with creds) the agent may log in with. `enginePort` targets the
   *  session's own host (multi-host model); omit to use the first open socket.
   *  Returns false if the target isn't connected. */
  run(text: string, sessionId?: string, accounts?: RunAccount[], env?: { id?: string; name?: string }, sourceAccess?: 'always' | 'ask' | 'deny', enginePort?: number, isolateContext?: boolean, intensity?: string, capabilities?: { api?: boolean; pentest?: boolean }, conversationId?: string): boolean;
  /** Reply to a source-read approval request from the engine's source MCP. */
  sendSourceApproval(approvalId: string, allow: boolean, enginePort?: number): void;
  /** Reply to an ask_user prompt from the engine's control MCP — the user's
   *  answer (a chosen option label or typed text), or cancelled. */
  sendAskUserResponse(askId: string, value: string | null, enginePort?: number): void;
  /** Cancel a run. `enginePort` cancels one host; omit to cancel all. */
  cancel(enginePort?: number): void;
  /** Crystallize the accumulated steps into a spec. `redactions` parameterize
   *  credential fill values into process.env refs so secrets stay out of the spec.
   *  `resetRecipe` (active env's, debt-2) → a tier-1 recipe makes the spec emit a
   *  resetState() beforeEach for reproducible runs. */
  saveSpec(name: string, steps: unknown[], redactions?: Redaction[], overwrite?: boolean, resetRecipe?: { tier: number; storageKeys?: string[]; hook?: string }, enginePort?: number, authFixture?: boolean): boolean;
  /** Invoke a plugin-contributed save handler (e.g. `save:pentest:report`,
   *  `save:security:spec`). The engine replies with `<type>:saved` or `error`. */
  pluginSave(type: string, payload: Record<string, unknown>, enginePort?: number): boolean;
  /** Ask the engine to launch the isolated debug Chrome at `pageUrl`
   *  (headless = silent, no window). `enginePort` targets the session's host. */
  launchChrome(pageUrl: string, headless: boolean, force?: boolean, enginePort?: number): boolean;
  /** Run the deterministic + LLM optimization pass on a saved spec.
   *  `optimizeModel` pins a cheap model for the pass (empty → agent default). */
  optimizeSpec(slug: string, optimizeModel?: string, enginePort?: number): boolean;
  /** Eagerly connect to a just-spawned host's port (skip the reconnect delay). */
  ensureConnected(port: number): void;
  /** Resolve once a socket to `port` is OPEN (or false on timeout). */
  whenOpen(port: number, timeoutMs?: number): Promise<boolean>;
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

  // The lowest-numbered open socket — used for host-agnostic ops (save, plugin
  // save, optimize) where any live host can serve the request.
  const firstOpen = (): WebSocket | undefined => {
    for (const p of [...sockets.keys()].sort((a, b) => a - b)) {
      const s = sockets.get(p);
      if (s && s.readyState === WebSocket.OPEN) return s;
    }
    return undefined;
  };

  /** Resolve a target socket: the specific host port if given + open, else the
   *  first open socket (back-compat / host-agnostic ops). */
  const target = (port?: number): WebSocket | undefined => {
    if (typeof port === 'number') {
      const s = sockets.get(port);
      return s && s.readyState === WebSocket.OPEN ? s : undefined;
    }
    return firstOpen();
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
        const cp = msg.payload as { apiCapabilityAvailable?: boolean; pentestCapabilityAvailable?: boolean } | undefined;
        handlers.onModes(current, available, { api: cp?.apiCapabilityAvailable === true, pentest: cp?.pentestCapabilityAvailable === true });
      } else if (msg.type === 'agents' && handlers.onAgents) {
        const current = typeof msg.payload?.current === 'string' ? msg.payload.current : null;
        const available = Array.isArray(msg.payload?.available) ? (msg.payload!.available as AgentEntry[]) : [];
        handlers.onAgents(current, available);
      } else if (typeof msg.type === 'string' && (msg.type === 'security:flow:added' || msg.type === 'security:flow:updated' || msg.type === 'security:flows:cleared')) {
        handlers.onFlow?.(msg as ServerMessage);
      } else if (
        msg.type === 'event' ||
        msg.type === 'error' ||
        msg.type === 'spec-saved' ||
        msg.type === 'run-active' ||
        msg.type === 'cdp-status' ||
        msg.type === 'screenshot' ||
        msg.type === 'qa-report' ||
        msg.type === 'qa-candidates' ||
        msg.type === 'reset-recipe' ||
        msg.type === 'optimize-result' ||
        msg.type === 'optimize-failed' ||
        msg.type === 'source-approval-request' ||
        msg.type === 'ask-user-request' ||
        (typeof msg.type === 'string' && msg.type.endsWith(':saved'))
      ) {
        handlers.onServerMessage?.(msg as ServerMessage, port);
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
    run(text: string, sessionId?: string, accounts?: RunAccount[], env?: { id?: string; name?: string }, sourceAccess?: 'always' | 'ask' | 'deny', enginePort?: number, isolateContext?: boolean, intensity?: string, capabilities?: { api?: boolean; pentest?: boolean }, conversationId?: string): boolean {
      const ws = target(enginePort);
      if (!ws) return false;
      ws.send(JSON.stringify({ type: 'command', payload: { text, sessionId, accounts, env, sourceAccess, isolateContext, intensity, capabilities, conversationId } }));
      return true;
    },
    sendSourceApproval(approvalId: string, allow: boolean, enginePort?: number): void {
      const ws = target(enginePort);
      if (ws) ws.send(JSON.stringify({ type: 'source-approval-response', payload: { approvalId, allow } }));
    },
    sendAskUserResponse(askId: string, value: string | null, enginePort?: number): void {
      const ws = target(enginePort);
      if (ws) ws.send(JSON.stringify({ type: 'ask-user-response', payload: value == null ? { askId, cancelled: true } : { askId, value } }));
    },
    cancel(enginePort?: number): void {
      if (typeof enginePort === 'number') {
        const ws = target(enginePort);
        if (ws) ws.send(JSON.stringify({ type: 'cancel' }));
        return;
      }
      for (const ws of sockets.values()) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'cancel' }));
      }
    },
    saveSpec(name: string, steps: unknown[], redactions?: Redaction[], overwrite?: boolean, resetRecipe?: { tier: number; storageKeys?: string[]; hook?: string }, enginePort?: number, authFixture?: boolean): boolean {
      const ws = target(enginePort);
      if (!ws) return false;
      ws.send(JSON.stringify({ type: 'save-spec', payload: { name, steps, redactions, overwrite, resetRecipe, authFixture } }));
      return true;
    },
    pluginSave(type: string, payload: Record<string, unknown>, enginePort?: number): boolean {
      const ws = target(enginePort);
      if (!ws) return false;
      ws.send(JSON.stringify({ type, payload }));
      return true;
    },
    launchChrome(pageUrl: string, headless: boolean, force?: boolean, enginePort?: number): boolean {
      const ws = target(enginePort);
      if (!ws) return false;
      ws.send(JSON.stringify({ type: 'launch-chrome', payload: { pageUrl, headless, force } }));
      return true;
    },
    optimizeSpec(slug: string, optimizeModel?: string, enginePort?: number): boolean {
      const ws = target(enginePort);
      if (!ws) return false;
      ws.send(JSON.stringify({ type: 'optimize-spec', payload: { slug, optimizeModel } }));
      return true;
    },
    ensureConnected(port: number): void {
      if (disposed) return;
      const t = timers.get(port);
      if (t) { clearTimeout(t); timers.delete(port); }
      const s = sockets.get(port);
      if (s && (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING)) return;
      connect(port);
    },
    whenOpen(port: number, timeoutMs = 8000): Promise<boolean> {
      const existing = sockets.get(port);
      if (existing && existing.readyState === WebSocket.OPEN) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const started = Date.now();
        const tick = setInterval(() => {
          const s = sockets.get(port);
          if (s && s.readyState === WebSocket.OPEN) { clearInterval(tick); resolve(true); }
          else if (Date.now() - started > timeoutMs) { clearInterval(tick); resolve(false); }
        }, 100);
      });
    },
    setModel(model: string): void {
      const body = JSON.stringify({ type: 'set-model', payload: { model } });
      for (const ws of sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(body);
    },
    setEffort(effort: string): void {
      const body = JSON.stringify({ type: 'set-effort', payload: { effort } });
      for (const ws of sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(body);
    },
    setLocalEndpoint(baseUrl: string): void {
      const body = JSON.stringify({ type: 'set-local-endpoint', payload: { baseUrl } });
      for (const ws of sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(body);
    },
    setByok(config: ByokConfig | null): void {
      const body = JSON.stringify({ type: 'set-byok', payload: { config } });
      for (const ws of sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(body);
    },
    refreshAgents(): void {
      const body = JSON.stringify({ type: 'refresh-agents' });
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
