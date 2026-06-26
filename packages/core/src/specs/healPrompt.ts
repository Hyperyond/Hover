/**
 * Self-heal Stage 2 — the heal prompt.
 *
 * When a saved spec fails on replay (the app changed → a locator no longer
 * matches), healing re-performs the flow against the LIVE app and fixes the
 * broken step(s). This builds the instruction that drives that run: the agent
 * gets the spec's intended flow (its source) + exactly what broke (the parsed
 * failures), and re-locates via the grounded control tools + source reader.
 *
 * The heal then crystallizes through the normal candidate flow (record_candidate
 * / fallback) — deterministic re-render, human-reviewed; the agent re-locates,
 * it does not author the spec. Pure: prompt-building only.
 */
import type { RunFailure } from './runFailures.js';

/** A short, chat-friendly label for the heal run (the user bubble), vs the full
 *  prompt the agent receives. */
export function healLabel(slug: string): string {
  return `🏥 Heal "${slug}" — re-running the flow to fix what changed`;
}

export function buildHealPrompt(slug: string, specSource: string, failures: RunFailure[]): string {
  const failureLines = failures.length > 0
    ? failures.map(f => {
        const what = f.failingLocator
          ? `${f.failingAction ?? 'a step'} on \`${f.failingLocator}\` no longer matches`
          : (f.error || 'a step failed');
        return `  - ${what}`;
      }).join('\n')
    : '  - (no structured failure captured — re-run the whole flow and fix whatever no longer works)';

  return [
    `You are REPAIRING a saved Playwright test that no longer passes because the`,
    `app under test changed. Re-perform its flow against the LIVE app and fix only`,
    `the step(s) that broke — do not invent new behavior or add unrelated steps.`,
    ``,
    `Test: "${slug}"`,
    ``,
    `What it does (the saved spec — this is the intended flow to reproduce):`,
    `\`\`\`ts`,
    specSource.trim(),
    `\`\`\``,
    ``,
    `What broke on replay:`,
    failureLines,
    ``,
    `How to repair it:`,
    `  - Open the app and walk the SAME flow, interacting through the grounded`,
    `    control tools (click_control / fill_control / select_control / …) so the`,
    `    repaired selectors stay replayable.`,
    `  - Where a step's old selector no longer matches, find the element that step`,
    `    INTENDED and operate that instead. Read the component source if you are`,
    `    unsure why it moved or what replaced it.`,
    `  - JUDGE broke-vs-changed: if a failure is because the app INTENTIONALLY`,
    `    changed (the feature now works differently — not a regression), adapt the`,
    `    flow to the new correct behavior and say so in your summary. If it looks`,
    `    like a real regression (the app is wrong), report it as a finding and heal`,
    `    to what the test originally intended.`,
    `  - Keep dynamic content dynamic: if a step grounds on data that varies`,
    `    run-to-run, flag it dynamic — don't freeze this run's value.`,
    ``,
    `When the flow works end to end, call record_candidate with the test's name so`,
    `the repaired version can be saved. Do not write any file yourself.`,
  ].join('\n');
}
