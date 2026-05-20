import type { AgentDescriptor, InvokeOptions, InvokeEvent } from './types.js';

type ContentBlock =
  | { type: 'text'; text?: string }
  | { type: 'tool_use'; name?: string; input?: unknown }
  | { type: 'tool_result'; content?: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown };

interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  mcp_servers?: { name: string; status: string }[];
  message?: { content?: ContentBlock[] };
  num_turns?: number;
  total_cost_usd?: number;
  result?: string;
  is_error?: boolean;
}

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
      if (ev.session_id) {
        out.push({ kind: 'session_start', sessionId: ev.session_id, model: ev.model });
      }
      for (const server of ev.mcp_servers ?? []) {
        out.push({ kind: 'mcp_status', server: server.name, status: server.status });
      }
      return out;
    }

    if (ev.type === 'assistant') {
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
