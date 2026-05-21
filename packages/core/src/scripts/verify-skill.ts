/**
 * Unit-level verification for writeSkill — writes a synthetic skill to the
 * basic-app project, reads it back, prints it.
 *
 *   pnpm --filter @hyperyond/core verify-skill
 */
import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSkill } from '../skills/writeSkill.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEV_ROOT = resolve(HERE, '..', '..', '..', '..', 'examples', 'basic-app');

const fixture = {
  devRoot: DEV_ROOT,
  name: 'fixture login-and-increment',
  description: 'Synthetic fixture — log in then click +1 twice',
  steps: [
    { kind: 'user' as const, text: 'log in as claude@sparkplay.io / demo1234, then +1 twice' },
    { kind: 'system' as const, text: 'session abc12345 · sonnet' },
    { kind: 'step' as const, tool: 'browser_navigate', input: { url: 'http://localhost:5173/' } },
    { kind: 'step' as const, tool: 'browser_snapshot', input: {} },
    {
      kind: 'step' as const,
      tool: 'browser_fill_form',
      input: { fields: [{ name: 'email', value: 'claude@sparkplay.io' }, { name: 'password', value: 'demo1234' }] },
    },
    { kind: 'step' as const, tool: 'browser_click', input: { element: 'Submit button' } },
    { kind: 'step' as const, tool: 'browser_click', input: { element: '+1 button' } },
    { kind: 'step' as const, tool: 'browser_click', input: { element: '+1 button' } },
    {
      kind: 'done' as const,
      turns: 8,
      costUsd: 0.0973,
      isError: false,
      summary: 'Logged in as claude@sparkplay.io. Counter went from 0 to 2.',
    },
  ],
};

const { path, slug } = await writeSkill(fixture);
console.log(`✓ wrote skill "${slug}" → ${path}\n`);
console.log('--- SKILL.md ---');
console.log(await readFile(path, 'utf-8'));

// Clean up the synthetic fixture so it doesn't pollute auto-discovery
await rm(dirname(path), { recursive: true, force: true });
console.log(`\n✓ cleanup: removed ${dirname(path)}`);
