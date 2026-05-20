/**
 * Ask Haiku 4.5 to propose a skill name + description from a recorded
 * session transcript. Used by the widget's Save-as-Skill flow so the user
 * gets a sensible default instead of staring at an empty prompt() box.
 *
 * Two timing tiers, both via claude CLI:
 *
 *   - When `ANTHROPIC_API_KEY` is set (or apiKeyHelper via settings), we use
 *     `--bare`: claude skips plugin sync, hooks, CLAUDE.md auto-discovery,
 *     keychain reads, and OAuth, cutting cold-start sharply (~1-3s).
 *   - Otherwise we use the normal `claude -p` path which reads OAuth from
 *     the user's claude.ai subscription. Slower (~10-15s) but no extra
 *     config needed.
 *
 * Either way, no MCP, every tool denied — pure text generation, capped at
 * $0.05 per call. Typical cost ~$0.0005 with haiku.
 */
import spawn from 'cross-spawn';
import type { SkillStep } from './writeSkill.js';

export interface NameSuggestion {
  name: string;
  description: string;
}

const MODEL = 'claude-haiku-4-5-20251001';
const BUDGET_USD = 0.05;
const TIMEOUT_MS = 30000;

export async function suggestSkillName(steps: SkillStep[]): Promise<NameSuggestion> {
  const prompt = buildPrompt(steps);
  const useBare = !!process.env.ANTHROPIC_API_KEY;

  return new Promise<NameSuggestion>((resolve, reject) => {
    const args: string[] = ['-p', prompt, '--model', MODEL, '--output-format', 'json'];

    if (useBare) {
      // --bare skips plugin sync / hooks / auto-memory / CLAUDE.md / keychain.
      // Requires ANTHROPIC_API_KEY (which we just checked for) or apiKeyHelper.
      args.push('--bare');
    } else {
      // OAuth path. Apply the same minimal-tools sandbox we use elsewhere.
      args.push(
        '--permission-mode', 'dontAsk',
        '--no-session-persistence',
        '--disallowedTools',
        'Bash', 'BashOutput', 'KillBash',
        'Edit', 'MultiEdit', 'Write', 'Read', 'NotebookEdit',
        'Grep', 'Glob', 'Task', 'TodoWrite',
        'WebFetch', 'WebSearch', 'ExitPlanMode',
        '--max-budget-usd', String(BUDGET_USD),
      );
    }

    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: '' },
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', d => (stdout += d.toString()));
    child.stderr?.on('data', d => (stderr += d.toString()));

    const killTimer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`suggest-name timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.on('error', err => {
      clearTimeout(killTimer);
      reject(err);
    });

    child.on('exit', code => {
      clearTimeout(killTimer);
      if (code !== 0) {
        reject(
          new Error(
            `suggest-name claude exited ${code}: ${stderr.slice(0, 200) || stdout.slice(0, 200)}`,
          ),
        );
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { result?: string };
        resolve(parseReply(parsed.result ?? ''));
      } catch (err) {
        reject(new Error(`suggest-name parse failed: ${(err as Error).message}`));
      }
    });
  });
}

function buildPrompt(steps: SkillStep[]): string {
  const transcript = renderTranscript(steps);
  return [
    'You are naming a saved browser-automation skill recorded by Hover.',
    'Read the transcript below and propose a short name + a one-line description.',
    '',
    '<transcript>',
    transcript,
    '</transcript>',
    '',
    'Reply with EXACTLY this format on two lines, nothing else:',
    '',
    'name: kebab-case-skill-name',
    'description: One concise English sentence (no trailing period)',
    '',
    'Rules:',
    '- Name is ≤ 30 chars, kebab-case, no quotes, reflects the actual work done',
    '- Description is ≤ 80 chars, plain English, no quotes',
    '- Prefer specifics over generic words like "test", "demo", "example"',
  ].join('\n');
}

function parseReply(reply: string): NameSuggestion {
  const nameMatch = reply.match(/^name:\s*(.+)$/m);
  const descMatch = reply.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch?.[1].trim() ?? '',
    description: descMatch?.[1].trim() ?? '',
  };
}

function renderTranscript(steps: SkillStep[]): string {
  const lines: string[] = [];
  for (const s of steps) {
    if (s.kind === 'user' && s.text) {
      lines.push(`User asked: ${s.text}`);
    } else if (s.kind === 'step' && s.tool) {
      const args = JSON.stringify(s.input ?? {});
      const short = args.length > 140 ? args.slice(0, 137) + '…' : args;
      lines.push(`Tool: ${s.tool} ${short}`);
    } else if (s.kind === 'done' && s.summary) {
      const short = s.summary.length > 240 ? s.summary.slice(0, 237) + '…' : s.summary;
      lines.push(`Final outcome: ${short}`);
    }
  }
  return lines.join('\n');
}
