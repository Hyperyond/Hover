import { describe, it, expect } from 'vitest';
import { buildHealPrompt, healLabel } from '../../src/specs/healPrompt.js';
import type { RunFailure } from '../../src/specs/runFailures.js';

describe('healLabel', () => {
  it('is a short chat-friendly label naming the spec', () => {
    expect(healLabel('flow-3')).toContain('flow-3');
    expect(healLabel('flow-3')).toContain('Heal');
  });
});

describe('buildHealPrompt', () => {
  const spec = `test('flow-3', async ({ page }) => {\n  await page.getByRole('button', { name: 'Submit' }).click();\n});`;
  const failures: RunFailure[] = [
    { specFile: 'flow-3.spec.ts', title: 'flow-3', error: 'locator.click: Timeout', failingLocator: "getByRole('button', { name: 'Submit' })", failingAction: 'click' },
  ];

  it('includes the slug, the spec source, and the failing locator', () => {
    const p = buildHealPrompt('flow-3', spec, failures);
    expect(p).toContain('"flow-3"');
    expect(p).toContain("getByRole('button', { name: 'Submit' })");
    expect(p).toContain('await page.getByRole'); // the spec source is embedded
  });

  it('instructs grounded re-location, broke-vs-changed judgment, and record_candidate', () => {
    const p = buildHealPrompt('flow-3', spec, failures);
    expect(p).toContain('click_control');
    expect(p).toMatch(/broke-vs-changed/i);
    expect(p).toContain('record_candidate');
    expect(p).toContain('Do not write any file yourself');
  });

  it('degrades gracefully when no structured failure was captured', () => {
    const p = buildHealPrompt('flow-3', spec, []);
    expect(p).toContain('no structured failure captured');
    expect(p).toContain('record_candidate');
  });
});
