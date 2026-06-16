import type { AgentDescriptor, InvokeOptions, InvokeEvent, ParserState } from './types.js';

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
 * Per-invocation running totals. Stored on the ParserState object that
 * invokeAgent threads through parseEvent / onStreamEnd so two concurrent
 * runs can't smear their accumulators together.
 */
interface ClaudeParserState extends ParserState {
  runningCost: number;
  runningTurns: number;
  runningTokens: number;
  runningModel: string | undefined;
}

function claudeState(state: ParserState): ClaudeParserState {
  // First touch on this state object — seed the keys we read below.
  if (typeof state.runningCost !== 'number') {
    state.runningCost = 0;
    state.runningTurns = 0;
    state.runningTokens = 0;
    state.runningModel = undefined;
  }
  return state as ClaudeParserState;
}

/** Every built-in claude-code tool that has nothing to do with driving a
 *  browser. Combined with `--strict-mcp-config` + an allow-list of mcp__*
 *  ids, this leaves Claude with only the Playwright MCP (plus any
 *  plugin-contributed MCPs) as a usable tool surface. */
const CLAUDE_DEFAULT_DISALLOWED_TOOLS: readonly string[] = [
  // file / shell / data access — never appropriate for browser driving
  'Bash', 'BashOutput', 'KillBash',
  'Edit', 'MultiEdit', 'Write', 'Read', 'NotebookEdit',
  'Grep', 'Glob', 'Task', 'TodoWrite',
  'WebFetch', 'WebSearch',
  // plan / worktree / cron / notification — irrelevant in -p mode
  'EnterPlanMode', 'ExitPlanMode',
  'EnterWorktree', 'ExitWorktree',
  'CronCreate', 'CronDelete', 'CronList',
  'PushNotification', 'RemoteTrigger',
  // task & tool introspection added in claude 2.1.x — let through and
  // the agent will burn turns exploring instead of executing
  'ToolSearch',
  'Monitor', 'TaskOutput', 'TaskStop',
  'AskUserQuestion',
  'ShareOnboardingGuide',
  // Skills are loaded independently of the --allowedTools allow-list, so an
  // allow-list of `mcp__playwright` does NOT block the `Skill` tool. Left
  // through, the agent burns a turn "checking for a project skill first" and
  // pollutes the crystallized spec with a junk `When · Skill` step. Deny it.
  'Skill',
  // Playwright MCP's arbitrary-JS tools. browser_run_code_unsafe /
  // browser_evaluate run any JS in the page — a real prompt-injection exfil
  // path (fetch a token out, read localStorage) that punches through the
  // "Playwright MCP only" sandbox, and their output can't be translated into
  // a deterministic Playwright spec anyway (it lands as a `// TODO`). Agents
  // drive via click/fill/select and read state via snapshot instead.
  'mcp__playwright__browser_run_code_unsafe',
  'mcp__playwright__browser_evaluate',
];

export const claudeAgent: AgentDescriptor = {
  id: 'claude',
  binName: 'claude',
  protocol: 'argv',
  streamFormat: 'stream-json',
  sandboxStrength: 'hard',
  defaultDisallowedTools: CLAUDE_DEFAULT_DISALLOWED_TOOLS,
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  display: {
    label: 'Claude Code',
    tagline: 'Anthropic — best-in-class browser driving, hard tool sandbox',
    homepage: 'https://docs.claude.com/claude-code',
    installHint: 'npm install -g @anthropic-ai/claude-code',
  },

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
    if (opts.effort) {
      args.push('--effort', opts.effort);
    }
    if (opts.sessionId) {
      args.push('--resume', opts.sessionId);
    }
    if (opts.appendSystemPrompt && opts.appendSystemPrompt.trim().length > 0) {
      args.push('--append-system-prompt', opts.appendSystemPrompt);
    }
    return args;
  },

  parseEvent(line: string, state: ParserState = {}): InvokeEvent[] {
    if (!line.trim()) return [];

    let ev: ClaudeStreamEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      return [{ kind: 'raw', line }];
    }

    const s = claudeState(state);
    const out: InvokeEvent[] = [];

    if (ev.type === 'system' && ev.subtype === 'init') {
      // Fresh session — reset the cost/turn accumulator.
      s.runningCost = 0;
      s.runningTurns = 0;
      s.runningTokens = 0;
      s.runningModel = ev.model;
      if (ev.session_id) {
        out.push({ kind: 'session_start', sessionId: ev.session_id, model: ev.model });
      }
      for (const server of ev.mcp_servers ?? []) {
        out.push({ kind: 'mcp_status', server: server.name, status: server.status });
      }
      return out;
    }

    if (ev.type === 'assistant') {
      s.runningTurns += 1;
      // Claude Code sometimes carries `total_cost_usd` on intermediate events;
      // when present it's authoritative (server-computed, includes anything
      // we'd miss). When absent, estimate from this turn's usage so the widget
      // still shows a growing $ counter on long runs.
      if (typeof ev.total_cost_usd === 'number') {
        s.runningCost = ev.total_cost_usd;
      } else if (ev.message?.usage) {
        s.runningCost += estimateCostUsd(s.runningModel ?? ev.message.model, ev.message.usage);
      }
      // Token consumption = fresh input + output only. We deliberately EXCLUDE
      // cache_read (and cache_creation): Claude re-reads ~the whole context from
      // cache every turn, so summing cache_read across turns inflates the total
      // ~5-10× and diverges from what Claude Code reports. input+output tracks
      // the new tokens processed, matching the user's mental model + CC's number.
      if (ev.message?.usage) {
        const u = ev.message.usage;
        s.runningTokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
      }
      out.push({ kind: 'usage', costUsd: s.runningCost, turns: s.runningTurns, tokens: s.runningTokens });

      for (const block of ev.message?.content ?? []) {
        if (block.type === 'tool_use') {
          const name = (block as { name?: string }).name ?? '';
          const tool = name.replace(/^mcp__playwright__/, '');
          out.push({
            kind: 'tool_use',
            tool,
            input: (block as { input?: unknown }).input,
            costUsdSnapshot: s.runningCost,
            tokensSnapshot: s.runningTokens,
          });
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
        tokens: s.runningTokens,
        isError: ev.is_error,
        summary: ev.result,
      });
      return out;
    }

    return [];
  },
};
