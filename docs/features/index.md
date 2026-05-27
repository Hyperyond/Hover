# Features

Everything Hover does today.

## Modes

- **[Security testing](./security)** ✨ NEW — install `@hover-dev/security` to route the debug Chrome through a local HTTPS MITM. The agent can list / inspect / replay captured API calls with mutations, probing for IDOR / authz bypass / parameter tampering / missing security headers / PII leakage. Crystallises into Playwright specs that run in CI without the proxy.

## Input

- **[Voice mode](./voice-mode)** — push-to-talk speech input + spoken step narration. 中文 / English autodetect, browser-native, no API keys.
- **[Record mode](./record-mode)** — record your own clicks / fills / selects as Playwright steps, with built-in Exists / Says / Equals assertion sub-modes.
- **[Fix prompt](./fix-prompt)** — click any element on the page, type what to change, get a precise prompt (source line:col + ancestor chain + Playwright selector) on your clipboard.

## Output

- **[Save as Spec](./save-as-spec)** — `__vibe_tests__/<slug>.spec.ts` using `getByRole / getByLabel / getByTestId`. Runs in CI without Hover.
- **[Save as Skill](./save-as-skill)** — `.claude/skills/<slug>/SKILL.md`. Replay by saying `execute <slug>`.
- **[Save as Jira case](./save-as-jira-case)** — `.case.csv`, imports straight into Jira / Xray / Zephyr.
- **[Findings cards](./findings-cards)** — bugs and observations the agent flagged, severity-coloured. First-class output, not buried in narration.
