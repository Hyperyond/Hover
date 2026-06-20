/**
 * Stateless relay message handlers, split out of startService's message switch.
 *
 * These message types only ROUTE messages between the connected sockets (the
 * editor, the in-page client, and the MCP server sockets) — they never read or
 * reassign the run's mutable state (currentMode/agent/model/activeRun/…), so
 * they extract cleanly with a small explicit dependency bundle instead of the
 * whole service closure:
 *   - reveal-source            page → editor (F2 element→source)
 *   - source-approval-request  source MCP → editor consent gate
 *   - source-approval-response editor decision → source MCP
 *   - ask-user-request         control MCP → every other client
 *   - ask-user-response        a client's answer → the asking MCP
 */
import { WebSocket, type WebSocketServer } from 'ws';
import { send, sendIfOpen, type ClientMessage } from './types.js';

export interface RelayDeps {
  wss: WebSocketServer;
  /** Read the active run's editor socket at call time (it is reassigned across
   *  runs, so this is a getter, not a captured value). */
  activeRunClient: () => WebSocket | null | undefined;
  pendingApprovals: Map<string, WebSocket>;
  pendingAsks: Map<string, WebSocket>;
}

/** Handle a stateless relay message. Returns true if `msg` was one of the relay
 *  types (and is now fully handled — the caller should stop), false otherwise. */
export function handleRelayMessage(ws: WebSocket, msg: ClientMessage, deps: RelayDeps): boolean {
  const { wss, pendingApprovals, pendingAsks } = deps;

  if (msg.type === 'reveal-source') {
    // F2 page→editor transport: relay a clicked element's `data-hover-source`
    // to every OTHER client; the VSCode extension opens <rel-path>:<line>:<col>.
    const source = msg.payload?.source;
    if (typeof source !== 'string' || !source) return true;
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        send(client, { type: 'reveal-source', payload: { source } });
      }
    }
    return true;
  }

  // Source-read approval gate (codeContext 'ask' mode): relay to the editor and
  // route its decision back. No editor → default allow (read-only fenced reader;
  // the gate is consent UX, never hang the run on it).
  if (msg.type === 'source-approval-request') {
    const id = msg.payload?.approvalId;
    if (typeof id !== 'string') return true;
    const editor = deps.activeRunClient();
    if (editor && editor.readyState === WebSocket.OPEN) {
      pendingApprovals.set(id, ws);
      send(editor, {
        type: 'source-approval-request',
        payload: { approvalId: id, sourcePath: msg.payload?.sourcePath, sourceKind: msg.payload?.sourceKind },
      });
    } else {
      sendIfOpen(ws, { type: 'source-approval-response', payload: { approvalId: id, allow: true } });
    }
    return true;
  }

  if (msg.type === 'source-approval-response') {
    const id = msg.payload?.approvalId;
    if (typeof id !== 'string') return true;
    const asker = pendingApprovals.get(id);
    pendingApprovals.delete(id);
    if (asker) sendIfOpen(asker, { type: 'source-approval-response', payload: { approvalId: id, allow: msg.payload?.allow === true } });
    return true;
  }

  // ask_user: the control MCP asks the human mid-run; forward to EVERY connected
  // client except the asking MCP (robust to a stale activeRun.client in the
  // reconnecting multi-host pool); route the answer back. No client → cancel so
  // the agent continues rather than hanging on the 5-min timeout.
  if (msg.type === 'ask-user-request') {
    const id = msg.payload?.askId;
    if (typeof id !== 'string') return true;
    const payload = {
      askId: id,
      question: msg.payload?.question,
      options: msg.payload?.options,
      allowFreeText: msg.payload?.allowFreeText,
    };
    let delivered = 0;
    for (const client of wss.clients) {
      if (client === ws) continue;
      if (client.readyState === WebSocket.OPEN) { send(client, { type: 'ask-user-request', payload }); delivered++; }
    }
    process.stderr.write(`[hover/ask] askId=${id} delivered to ${delivered} client(s)\n`);
    if (delivered > 0) pendingAsks.set(id, ws);
    else sendIfOpen(ws, { type: 'ask-user-response', payload: { askId: id, cancelled: true } });
    return true;
  }

  if (msg.type === 'ask-user-response') {
    const id = msg.payload?.askId;
    if (typeof id !== 'string') return true;
    const asker = pendingAsks.get(id);
    pendingAsks.delete(id);
    if (asker) sendIfOpen(asker, { type: 'ask-user-response', payload: msg.payload });
    return true;
  }

  return false;
}
