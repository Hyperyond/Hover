/**
 * Ask claude (haiku, no tools) to propose a skill name + description from a
 * recorded session transcript. Used by the widget's Save-as-Skill flow so the
 * user gets a sensible default instead of staring at an empty prompt() box.
 *
 * This is a fire-and-forget side call that does NOT share state with the main
 * agent invocation: no MCP, no Playwright, no inherited session id. Budget is
 * hard-capped at $0.05 — a typical call is ~$0.0005 with haiku.
 */
import spawn from 'cross-spawn';
import type { SkillStep } from './writeSkill.js';

export interface NameSuggestion {
  name: string;
  description: string;
}

const SUGGEST_MODEL = 'haiku';
const SUGGEST_BUDGET_USD = 0.05;
const SUGGEST_TIMEOUT_MS = 30000;

export async function suggestSkillName(steps: SkillStep[]): Promise<NameSuggestion> {
  const transcript = renderTranscript(steps);
  const prompt = [
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

  return new Promise<NameSuggestion>((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p', prompt,
        '--model', SUGGEST_MODEL,
        '--output-format', 'json',
        '--permission-mode', 'dontAsk',
        // Deny every tool — this is a pure text generation call. Without an
        // explicit deny list, dontAsk lets through "read-only" built-ins like
        // TodoWrite which would just waste tokens for our use case.
        '--disallowedTools',
        'Bash', 'BashOutput', 'KillBash',
        'Edit', 'MultiEdit', 'Write', 'Read', 'NotebookEdit',
        'Grep', 'Glob', 'Task', 'TodoWrite',
        'WebFetch', 'WebSearch', 'ExitPlanMode',
        '--max-budget-usd', String(SUGGEST_BUDGET_USD),
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDECODE: '' },
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', d => (stdout += d.toString()));
    child.stderr?.on('data', d => (stderr += d.toString()));

    const killTimer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`suggest-name timed out after ${SUGGEST_TIMEOUT_MS}ms`));
    }, SUGGEST_TIMEOUT_MS);

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
        const reply = parsed.result ?? '';
        const nameMatch = reply.match(/^name:\s*(.+)$/m);
        const descMatch = reply.match(/^description:\s*(.+)$/m);
        resolve({
          name: nameMatch?.[1].trim() ?? '',
          description: descMatch?.[1].trim() ?? '',
        });
      } catch (err) {
        reject(new Error(`suggest-name parse failed: ${(err as Error).message}`));
      }
    });
  });
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
