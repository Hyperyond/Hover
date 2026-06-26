import { describe, it, expect } from 'vitest';
import { parseRunFailures, extractLocator, extractAction } from '../../src/specs/runFailures.js';

describe('extractLocator', () => {
  it('pulls a getByRole call with a name option out of an error', () => {
    const msg = "locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Submit' })";
    expect(extractLocator(msg)).toBe("getByRole('button', { name: 'Submit' })");
  });
  it('keeps a .first() tail', () => {
    expect(extractLocator('waiting for getByRole("heading").first()')).toBe('getByRole("heading").first()');
  });
  it('handles getByText from an expect failure', () => {
    expect(extractLocator("expect(locator).toBeVisible() failed\nLocator: getByText('apple')")).toBe("getByText('apple')");
  });
  it('returns undefined when there is no locator', () => {
    expect(extractLocator('Test timeout of 30000ms exceeded.')).toBeUndefined();
  });
});

describe('extractAction', () => {
  it('reads the action from a locator.<action>: prefix', () => {
    expect(extractAction('locator.fill: Target closed')).toBe('fill');
    expect(extractAction('locator.click: Timeout')).toBe('click');
  });
  it('classifies an expect failure as assert', () => {
    expect(extractAction('expect(locator).toHaveText(...) failed')).toBe('assert');
    expect(extractAction('Error: expect(received).toBeVisible()')).toBe('assert');
  });
  it('returns undefined for an unrecognized error', () => {
    expect(extractAction('Some unrelated failure')).toBeUndefined();
  });
});

describe('parseRunFailures', () => {
  const run = {
    suites: [
      {
        title: 'flow-3.spec.ts',
        file: 'flow-3.spec.ts',
        specs: [
          {
            title: 'flow-3', file: 'flow-3.spec.ts', ok: false,
            tests: [{ results: [{ status: 'failed', error: { message: "locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: '认识' })" } }] }],
          },
        ],
        // a nested describe with a passing spec — must be ignored
        suites: [
          {
            title: 'group', file: 'flow-3.spec.ts',
            specs: [{ title: 'passing one', file: 'flow-3.spec.ts', ok: true, tests: [{ results: [{ status: 'passed' }] }] }],
          },
        ],
      },
    ],
  };

  it('extracts the failing spec with its locator + action', () => {
    const failures = parseRunFailures(run);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      specFile: 'flow-3.spec.ts',
      title: 'flow-3',
      failingLocator: "getByRole('button', { name: '认识' })",
      failingAction: 'click',
    });
    expect(failures[0].error).toBe('locator.click: Timeout 5000ms exceeded.');
  });

  it('accepts a JSON string', () => {
    expect(parseRunFailures(JSON.stringify(run))).toHaveLength(1);
  });

  it('returns [] for a clean run, malformed JSON, or junk', () => {
    expect(parseRunFailures({ suites: [{ specs: [{ ok: true, tests: [{ results: [{ status: 'passed' }] }] }] }] })).toEqual([]);
    expect(parseRunFailures('not json {')).toEqual([]);
    expect(parseRunFailures(null)).toEqual([]);
    expect(parseRunFailures(42)).toEqual([]);
  });

  it('records a failure with no locator (e.g. a bare timeout) with undefined locator', () => {
    const failures = parseRunFailures({
      suites: [{ file: 'x.spec.ts', specs: [{ title: 'x', ok: false, tests: [{ results: [{ status: 'timedOut', error: { message: 'Test timeout of 30000ms exceeded.' } }] }] }] }],
    });
    expect(failures).toHaveLength(1);
    expect(failures[0].failingLocator).toBeUndefined();
    expect(failures[0].title).toBe('x');
  });
});
