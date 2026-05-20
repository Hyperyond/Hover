/**
 * Quick check that suggestSkillName actually spawns haiku and returns a
 * usable name+description. Costs ~$0.0005 per run.
 *
 *   pnpm --filter @hover/core verify-suggest
 */
import { suggestSkillName } from '../skills/suggestName.js';
import type { SkillStep } from '../skills/writeSkill.js';

const fixture: SkillStep[] = [
  { kind: 'user', text: 'log in as claude@sparkplay.io / demo1234 then click +1 twice' },
  { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/' } },
  {
    kind: 'step',
    tool: 'browser_fill_form',
    input: { fields: [{ name: 'email', value: 'claude@sparkplay.io' }, { name: 'password', value: 'demo1234' }] },
  },
  { kind: 'step', tool: 'browser_click', input: { element: 'Submit button' } },
  { kind: 'step', tool: 'browser_click', input: { element: '+1 button' } },
  { kind: 'step', tool: 'browser_click', input: { element: '+1 button' } },
  { kind: 'done', turns: 6, costUsd: 0.1, summary: 'Logged in as claude@sparkplay.io. Counter is now 2.' },
];

const path = process.env.ANTHROPIC_API_KEY ? 'claude --bare (fast)' : 'claude OAuth (slow)';
console.log(`• Path: ${path}`);
console.log('• Asking haiku 4.5 for a name suggestion...\n');

const t0 = Date.now();
const sugg = await suggestSkillName(fixture);
const ms = Date.now() - t0;

console.log(`✓ Returned in ${ms}ms`);
console.log(`  name:        ${JSON.stringify(sugg.name)}`);
console.log(`  description: ${JSON.stringify(sugg.description)}`);
