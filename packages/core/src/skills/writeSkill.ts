/**
 * Save a completed Hover session as a Claude Code skill.
 *
 * Writes a SKILL.md under `<devRoot>/.claude/skills/<slug>/`. When the agent
 * is later spawned with `cwd: devRoot`, Claude Code auto-discovers the skill
 * and can replay it when the user describes the same task in natural language
 * (e.g. "run the login-and-add-todo skill").
 *
 * Two reasons this is just-good-enough for v1:
 *  - The exact tool calls (with args) become numbered steps the agent can
 *    replay literally. Same dev server, same selectors → same outcome.
 *  - The original user prompt + AI outcome are preserved as prose. If the
 *    page changed and the literal selectors no longer apply, the agent has
 *    enough context to adapt rather than fail.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Serialized message shape from the widget's localStorage. Matches the
 * `state.messages` schema in packages/vite-plugin/src/widget.js.
 */
export interface SkillStep {
  kind: 'user' | 'system' | 'step' | 'ai' | 'done';
  text?: string;
  tool?: string;
  input?: unknown;
  isError?: boolean;
  turns?: number;
  costUsd?: number;
  summary?: string;
}

export interface WriteSkillOptions {
  /** Directory under which `.claude/skills/<slug>/` is created. Usually the
   *  Vite project root (`server.config.root`). */
  devRoot: string;
  name: string;
  description?: string;
  steps: SkillStep[];
}

export interface WriteSkillResult {
  path: string;
  slug: string;
}

export async function writeSkill(opts: WriteSkillOptions): Promise<WriteSkillResult> {
  const slug = slugify(opts.name);
  if (!slug) {
    throw new Error('skill name must contain at least one alphanumeric character');
  }
  if (!opts.steps.some(s => s.kind === 'step')) {
    throw new Error('skill must contain at least one tool_use step to replay');
  }

  const dir = join(opts.devRoot, '.claude', 'skills', slug);
  await mkdir(dir, { recursive: true });

  const md = renderSkill(slug, opts.description ?? '', opts.steps);
  const path = join(dir, 'SKILL.md');
  await writeFile(path, md, 'utf-8');
  return { path, slug };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renderSkill(slug: string, description: string, steps: SkillStep[]): string {
  const userMsg = steps.find(s => s.kind === 'user');
  const doneMsg = [...steps].reverse().find(s => s.kind === 'done');
  const toolSteps = steps.filter(s => s.kind === 'step');

  const out: string[] = [];
  out.push('---');
  out.push(`name: ${slug}`);
  // YAML description — quote if it contains anything that could confuse the parser
  out.push(`description: ${yamlString(description || slug)}`);
  out.push('---');
  out.push('');

  if (userMsg?.text) {
    out.push('## Original intent');
    out.push('');
    out.push(blockquote(userMsg.text));
    out.push('');
  }

  out.push('## Replay steps');
  out.push('');
  out.push(
    'Replay these steps using the `mcp__playwright` tools, in order. ' +
      'If a literal selector id (e.g. `e15`) no longer matches, interpret the ' +
      'natural-language element description instead — selector ids regenerate on every snapshot.',
  );
  out.push('');
  out.push(
    'Do not narrate each step, do not summarize at the end. Hover surfaces ' +
      'tool calls + the final result to the user automatically — extra commentary is noise.',
  );
  out.push('');

  toolSteps.forEach((step, i) => {
    const tool = step.tool ?? '(unknown)';
    const inputStr = JSON.stringify(step.input ?? {});
    const truncated = inputStr.length > 240 ? inputStr.slice(0, 237) + '…' : inputStr;
    out.push(`${i + 1}. \`${tool}\` — \`${truncated}\``);
  });

  out.push('');

  if (doneMsg?.summary) {
    out.push('## Original outcome');
    out.push('');
    out.push(doneMsg.summary.trim());
    out.push('');
  }

  return out.join('\n');
}

function yamlString(s: string): string {
  // Cheap quoting — if it has YAML-significant chars, double-quote and escape.
  if (/[:#\n"'\\]/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

function blockquote(s: string): string {
  return s
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}
