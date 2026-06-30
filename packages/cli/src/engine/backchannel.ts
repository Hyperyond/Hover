import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { SkillStep } from '@hover-dev/core/engine';

/*
 * The control-actuation MCP server (`actuateServer.js`) talks back to its host
 * over a WebSocket at `HOVER_APPROVAL_PORT` — the same channel the extension's
 * service exposes. The extension's WS service IS that host; a standalone CLI has
 * no service, so we run this tiny dedicated WS server and pass its port as the
 * approval port. It receives the back-channel messages the control server emits:
 *
 *   record-candidate     { candidate: { name, description?, steps } }  (fire-and-forget)
 *   record-fact          { fact: { title, rule, type? } }              (fire-and-forget)
 *   record-reset-recipe  { recipe: { tier, storageKeys?, verified?, note? } }
 *   ask-user-request     { askId, question, options, allowFreeText }   → ask-user-response
 *
 * Grounded actuation itself does NOT use this channel (it drives CDP directly),
 * so a CLI run works without it — it only unlocks candidates / facts / asking.
 */

export interface Candidate {
  name: string;
  description?: string;
  /** Grounded steps the control server buffered for this flow — ready for
   *  `writeSpec`. */
  steps: SkillStep[];
}
export interface Fact {
  title: string;
  rule: string;
  type?: string;
}
export interface ResetRecipe {
  tier: number;
  storageKeys?: string[];
  verified?: boolean;
  note?: string;
}
export interface AskRequest {
  askId: string;
  question: string;
  options: { label: string; description?: string }[];
  allowFreeText: boolean;
}
export interface AskAnswer {
  value?: string;
  cancelled?: boolean;
}

export interface BackchannelHandlers {
  onCandidate?: (c: Candidate) => void;
  onFact?: (f: Fact) => void;
  onResetRecipe?: (r: ResetRecipe) => void;
  /** Resolve with the user's answer, or `{ cancelled: true }` to dismiss. */
  onAsk?: (req: AskRequest) => Promise<AskAnswer>;
}

export interface Backchannel {
  /** The port to pass as `HOVER_APPROVAL_PORT` (→ buildGroundedMcpConfig). */
  port: number;
  /** Swap handlers between phases (explore vs verify) without reopening. */
  setHandlers: (h: BackchannelHandlers) => void;
  close: () => Promise<void>;
}

export async function startBackchannel(initial: BackchannelHandlers = {}): Promise<Backchannel> {
  let handlers = initial;
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });
  const port = (wss.address() as AddressInfo).port;

  wss.on('connection', (sock: WebSocket) => {
    sock.on('message', async (data: Buffer) => {
      let msg: { type?: string; payload?: Record<string, unknown> };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return; // ignore malformed
      }
      const p = (msg.payload ?? {}) as Record<string, unknown>;
      switch (msg.type) {
        case 'record-candidate':
          if (p.candidate) handlers.onCandidate?.(p.candidate as Candidate);
          break;
        case 'record-fact':
          if (p.fact) handlers.onFact?.(p.fact as Fact);
          break;
        case 'record-reset-recipe':
          if (p.recipe) handlers.onResetRecipe?.(p.recipe as ResetRecipe);
          break;
        case 'ask-user-request': {
          const req: AskRequest = {
            askId: String(p.askId ?? ''),
            question: String(p.question ?? ''),
            options: Array.isArray(p.options) ? (p.options as AskRequest['options']) : [],
            allowFreeText: p.allowFreeText === true,
          };
          const answer: AskAnswer = handlers.onAsk
            ? await handlers.onAsk(req).catch((): AskAnswer => ({ cancelled: true }))
            : { cancelled: true };
          sock.send(
            JSON.stringify({
              type: 'ask-user-response',
              payload: { askId: req.askId, value: answer.value, cancelled: answer.cancelled },
            }),
          );
          break;
        }
        default:
          break; // source-approval etc. — not used until codeContext is wired
      }
    });
  });

  return {
    port,
    setHandlers: (h) => {
      handlers = h;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) {
          try {
            c.terminate();
          } catch {
            /* already gone */
          }
        }
        wss.close(() => resolve());
      }),
  };
}
