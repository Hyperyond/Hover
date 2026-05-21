import type { AgentDescriptor, InvokeOptions, InvokeEvent } from './types.js';

type ContentBlock =
  | { type: 'text'; text?: string }
  | { type: 'tool_use'; name?: string; input?: unknown }
  | { type: 'tool_result'; content?: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown };

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  mcp_servers?: { name: string; status: string }[];
  message?: { content?: ContentBlock[]; usage?: ClaudeUsage; model?: string };
  num_turns?: number;
  total_cost_usd?: number;
  result?: string;
  is_error?: boolean;
}

/**
 * Running-cost accumulator across one parser lifecycle. Claude Code's
 * stream-json sometimes carries `total_cost_usd` on intermediate events; when
 * it does we just forward it. When it doesn't, we estimate from token usage
 * using public per-million pricing. Hardcoded rates because they change
 * rarely and we'd rather not network-fetch a price table from a sandbox.
 *
 * The estimate is empirically about 1.5–2× the authoritative
 * `total_cost_usd` that arrives on the final `result` event (overhead from
 * tool-definition tokens we don't see + Claude's actual cache hit ratios
 * vs. our pessimistic accounting). That's fine for the widget's purpose:
 * give the user a signal of cost direction and order-of-magnitude so they
 * know when to hit Stop. The done card displays the final authoritative
 * number from `total_cost_usd`, so the user always sees the ground truth.
 */
const PRICE_PER_M_USD: Record<string, { in: number; out: number; cacheCreate: number; cacheRead: number }> = {
  // claude-sonnet-4 / 4.5 / 4.6 / 4.7 — all priced the same as of 2026
  sonnet: { in: 3, out: 15, cacheCreate: 3.75, cacheRead: 0.3 },
  opus:   { in: 15, out: 75, cacheCreate: 18.75, cacheRead: 1.5 },
  haiku:  { in: 1, out: 5, cacheCreate: 1.25, cacheRead: 0.1 },
};

function estimateCostUsd(modelHint: string | undefined, usage: ClaudeUsage): number {
  // Match the most specific tier by substring. e.g. 'claude-sonnet-4-6' → sonnet.
  const m = (modelHint ?? 'sonnet').toLowerCase();
  const tier =
    m.includes('opus') ? PRICE_PER_M_USD.opus :
    m.includes('haiku') ? PRICE_PER_M_USD.haiku :
    PRICE_PER_M_USD.sonnet;
  return (
    (usage.input_tokens ?? 0) * tier.in +
    (usage.output_tokens ?? 0) * tier.out +
    (usage.cache_creation_input_tokens ?? 0) * tier.cacheCreate +
    (usage.cache_read_input_tokens ?? 0) * tier.cacheRead
  ) / 1_000_000;
}

/**
 * Per-session running totals. Reset on every `system/init` event (one per
 * agent invocation). Safe as module-level state because service.ts enforces
 * one in-flight invocation per Hover service via its `busy` lock, and each
 * Vite dev server spawns its own Node process with its own module instance.
 */
let runningCost = 0;
let runningTurns = 0;
let runningModel: string | undefined;

export const claudeAgent: AgentDescriptor = {
  id: 'claude',
  binName: 'claude',
  protocol: 'argv',
  streamFormat: 'stream-json',

  buildArgs(opts: InvokeOptions): string[] {
    const args: string[] = ['-p', opts.prompt];
    args.push('--output-format', 'stream-json', '--verbose');
    args.push('--permission-mode', 'dontAsk');
    if (opts.mcpConfig) {
      args.push('--mcp-config', opts.mcpConfig, '--strict-mcp-config');
    }
    if (opts.allowedTools?.length) {
      args.push('--allowedTools', ...opts.allowedTools);
    }
    if (opts.disallowedTools?.length) {
      args.push('--disallowedTools', ...opts.disallowedTools);
    }
    if (opts.maxBudgetUsd != null) {
      args.push('--max-budget-usd', String(opts.maxBudgetUsd));
    }
    if (opts.model) {
      args.push('--model', opts.model);
    }
    if (opts.sessionId) {
      args.push('--resume', opts.sessionId);
    }
    if (opts.appendSystemPrompt && opts.appendSystemPrompt.trim().length > 0) {
      args.push('--append-system-prompt', opts.appendSystemPrompt);
    }
    return args;
  },

  parseEvent(line: string): InvokeEvent[] {
    if (!line.trim()) return [];

    let ev: ClaudeStreamEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      return [{ kind: 'raw', line }];
    }

    const out: InvokeEvent[] = [];

    if (ev.type === 'system' && ev.subtype === 'init') {
      // Fresh session — reset the cost/turn accumulator.
      runningCost = 0;
      runningTurns = 0;
      runningModel = ev.model;
      if (ev.session_id) {
        out.push({ kind: 'session_start', sessionId: ev.session_id, model: ev.model });
      }
      for (const server of ev.mcp_servers ?? []) {
        out.push({ kind: 'mcp_status', server: server.name, status: server.status });
      }
      return out;
    }

    if (ev.type === 'assistant') {
      runningTurns += 1;
      // Claude Code sometimes carries `total_cost_usd` on intermediate events;
      // when present it's authoritative (server-computed, includes anything
      // we'd miss). When absent, estimate from this turn's usage so the widget
      // still shows a growing $ counter on long runs.
      if (typeof ev.total_cost_usd === 'number') {
        runningCost = ev.total_cost_usd;
      } else if (ev.message?.usage) {
        runningCost += estimateCostUsd(runningModel ?? ev.message.model, ev.message.usage);
      }
      out.push({ kind: 'usage', costUsd: runningCost, turns: runningTurns });

      for (const block of ev.message?.content ?? []) {
        if (block.type === 'tool_use') {
          const name = (block as { name?: string }).name ?? '';
          const tool = name.replace(/^mcp__playwright__/, '');
          out.push({ kind: 'tool_use', tool, input: (block as { input?: unknown }).input });
        } else if (block.type === 'text') {
          const text = (block as { text?: string }).text?.trim();
          if (text) out.push({ kind: 'text', text });
        }
      }
      return out;
    }

    if (ev.type === 'user') {
      for (const block of ev.message?.content ?? []) {
        if (block.type === 'tool_result') {
          out.push({ kind: 'tool_result', isError: (block as { is_error?: boolean }).is_error });
        }
      }
      return out;
    }

    if (ev.type === 'result') {
      out.push({
        kind: 'session_end',
        turns: ev.num_turns,
        costUsd: ev.total_cost_usd,
        isError: ev.is_error,
        summary: ev.result,
      });
      return out;
    }

    return [];
  },
};
