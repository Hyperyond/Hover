/**
 * Unit-level verification for writeSpec — writes a synthetic Playwright spec
 * to the basic-app project, prints the result, cleans up.
 *
 *   pnpm --filter @hover-dev/core verify-spec
 */
import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSpec, type SpecAssertion } from '../specs/writeSpec.js';
import type { SpecStep } from '../specs/writeSpec.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEV_ROOT = resolve(HERE, '..', '..', '..', '..', 'examples', 'basic-app');

const fixtureSteps: SpecStep[] = [
  { kind: 'user', text: 'log in as claude@sparkplay.io / demo1234, then click +1 twice' },
  { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/' } },
  { kind: 'step', tool: 'browser_snapshot', input: {} },
  {
    kind: 'step',
    tool: 'browser_fill_form',
    input: {
      fields: [
        { name: 'email', type: 'textbox', value: 'claude@sparkplay.io' },
        { name: 'password', type: 'textbox', value: 'demo1234' },
      ],
    },
  },
  { kind: 'step', tool: 'browser_click', input: { element: 'Submit button' } },
  { kind: 'step', tool: 'browser_click', input: { element: '+1 button' } },
  { kind: 'step', tool: 'browser_click', input: { element: '+1 button' } },
  { kind: 'done', turns: 7, costUsd: 0.09, summary: 'Logged in. Counter is 2.' },
];

const fixtureAssertions: SpecAssertion[] = [
  {
    code: `expect(page.getByTestId('welcome')).toHaveText('claude@sparkplay.io')`,
    hint: 'welcome banner reflects the email used for login',
  },
  {
    code: `expect(page.getByTestId('count')).toHaveText('2')`,
    hint: 'counter shows 2 after two +1 clicks',
  },
];

const { path, slug } = await writeSpec({
  devRoot: DEV_ROOT,
  name: 'fixture login flow',
  steps: fixtureSteps,
  assertions: fixtureAssertions,
});
console.log(`✓ wrote spec "${slug}" → ${path}\n`);
console.log('--- generated .spec.ts ---');
console.log(await readFile(path, 'utf-8'));

// Clean up
await rm(path, { force: true });
console.log(`\n✓ cleanup: removed ${path}`);
