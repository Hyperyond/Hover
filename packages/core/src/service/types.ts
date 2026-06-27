/**
 * Shared types for the service/ handler modules.
 *
 * `ClientMessage` describes the wire-protocol envelope every message from
 * the widget arrives in. Lives here (not in service.ts) so individual
 * handlers can type their `msg` argument without circular imports.
 *
 * `send` is the one-liner used by every handler to emit a typed message
 * back to the widget. Centralised so the JSON.stringify happens in exactly
 * one place.
 */

import { WebSocket } from 'ws';
import type { SkillStep } from '../specs/specStep.js';
import type { SpecAssertion } from '../specs/writeSpec.js';

export interface ClientMessage {
  type: string;
  payload?: {
    text?: string;
    sessionId?: string;
    /** The chat conversation a run belongs to — groups its run folders under
     *  `.hover/runs/<conversationId>/`. */
    conversationId?: string;
    name?: string;
    description?: string;
    steps?: SkillStep[];
    assertions?: SpecAssertion[];
    overwrite?: boolean;
    /** save-spec only — credentials to parameterize into process.env.<envVar>
     *  references so secrets never land in the spec / sidecar. */
    redactions?: { value: string; envVar: string }[];
    /** save-spec only — the active env's recon-discovered reset recipe (debt-2).
     *  A tier-1 recipe makes the spec generate + call a resetState() beforeEach. */
    resetRecipe?: { tier: number; storageKeys?: string[]; hook?: string };
    /** save-spec only — auth-as-fixture (debt 3). The user approved Hover editing
     *  their existing playwright.config; engage the fixture (lift login into
     *  auth.setup.ts) and apply the setup-project edit. Absent on a normal save. */
    authFixture?: boolean;
    /** command only — test accounts the prompt referenced via @label. Injected
     *  into the agent's system prompt (ephemeral, not the saved transcript) so
     *  it can log in; the recorded fill values get redacted on save. */
    accounts?: { label: string; username?: string; password?: string; role?: string }[];
    /** command only — ask the agent to run state-reset recon this run (debt-2
     *  reproducible-state-isolation). Off unless the extension sets it (e.g. the
     *  active env has no reset recipe yet); recon clears client state, so it must
     *  be opt-in, never on a plain Flow recording. */
    reconReset?: boolean;
    /** check-cdp / launch-chrome / focus-debug — the widget's
     *  window.location.href so service can compare origins or navigate the
     *  newly-launched debug Chrome to the same URL. */
    pageUrl?: string;
    /** switch-agent only — id of the agent to switch the service to. */
    agentId?: string;
    /** set-model only — the model id to use for subsequent runs (e.g. opus). */
    model?: string;
    /** optimize-spec only — override model for the F7 refinement pass (the
     *  `hover.optimizeModel` setting). Empty → the agent's cheap default. */
    optimizeModel?: string;
    /** heal-spec only — the failing spec's source, so the engine can build the
     *  heal prompt without guessing the spec's path. */
    specSource?: string;
    /** set-effort only — reasoning-effort level for subsequent runs (empty
     *  string clears it → agent/model default). */
    effort?: string;
    /** set-local-endpoint only — base URL of the user's self-hosted
     *  OpenAI-compatible endpoint for the Local LLM agent. */
    baseUrl?: string;
    /** set-byok only — bring-your-own-key model config (protocol + key + base
     *  URL + model injected into the protocol's matching CLI), or null to clear
     *  and fall back to the local-CLI agent's own auth. */
    config?: {
      protocol: string;
      baseUrl: string;
      model: string;
      maxTokens: number;
      apiKey: string;
    } | null;
    /** set-mode only — id of the plugin-contributed mode to activate,
     *  or null to return to normal (unmoded) operation. */
    modeId?: string | null;
    /** optimize-spec / promote-optimized / discard-optimized — the spec slug. */
    slug?: string;
    /** launch-chrome only — launch the debug Chrome headless (silent mode). */
    headless?: boolean;
    /** launch-chrome only — close any existing debug Chrome first, then
     *  relaunch (so a headless↔visible switch / "reopen browser" takes effect). */
    force?: boolean;
    /** reveal-source only — a `data-hover-source` value (`<rel-path>:<line>:<col>`)
     *  an in-page client (widget) captured from a clicked element. The service
     *  relays it to every OTHER connected client; the VSCode extension listens
     *  for it and jumps the editor to that location (F2 page→editor transport). */
    source?: string;
    /** command only — the editor's source-read grant for this run:
     *  'always' (skip the gate), 'ask' (gate each read), 'deny' (no source MCP).
     *  Default 'ask' when absent. */
    sourceAccess?: 'always' | 'ask' | 'deny';
    /** command only — run the agent in an isolated cwd so it loads none of the
     *  user's CLAUDE.md / Claude Code auto-memory (Memory = "isolated"). */
    isolateContext?: boolean;
    /** command only — the active environment, recorded in the session ledger. */
    env?: { id?: string; name?: string };
    /** source-approval-request (from the source MCP) / -response (from the
     *  editor): a correlation id, the requested repo-relative path + kind, and
     *  the user's allow/deny decision. */
    approvalId?: string;
    sourcePath?: string;
    sourceKind?: string;
    allow?: boolean;
    /** ask-user-request (from the control MCP) / -response (from the editor):
     *  a correlation id, the question + offered choices, and the user's answer. */
    askId?: string;
    question?: string;
    options?: { label: string; description?: string }[];
    allowFreeText?: boolean;
    value?: string;
    cancelled?: boolean;
    /** record-fact (from the control MCP, QA/API modes only): a business RULE
     *  the agent learned/confirmed, to persist into `.hover/memory/` so it isn't
     *  re-asked next run. RULES only — never secrets/PII (the tool + directive
     *  enforce this; the engine also ignores it outside QA/API). */
    fact?: { title: string; rule: string; type?: string };
  };
}

export function send(ws: WebSocket, message: { type: string; payload?: unknown }): void {
  ws.send(JSON.stringify(message));
}

/** Send a message only if the socket is still open. Use this from delayed
 *  callbacks (promise `.then`, timers) where the client may have disconnected
 *  between scheduling and firing — calling `ws.send` on a closed socket
 *  is a silent no-op for some states and throws for others, so a single
 *  guarded helper makes the intent obvious and prevents surprises. */
export function sendIfOpen(
  ws: WebSocket,
  message: { type: string; payload?: unknown },
): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(message));
  return true;
}
