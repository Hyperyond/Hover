# Features

Everything Hover does today.

## Modes

- **[Security testing](./security)** — install `@hover-dev/security` to route the debug Chrome through a local HTTPS MITM. The agent can list / inspect / replay captured API calls with mutations, probing for IDOR / authz bypass / parameter tampering / missing security headers / PII leakage. Crystallises into Playwright specs that run in CI without the proxy.

## Input

- **[Voice mode](./voice-mode)** — push-to-talk speech input + spoken step narration. 中文 / English autodetect, browser-native, no API keys.
- **[Record mode](./record-mode)** ✨ UPDATED (v0.13) — record your own clicks / fills / selects as Playwright steps, with built-in Exists / Says / Equals assertion sub-modes. v0.13 captures the starting URL as `page.goto` so saved Records replay from the right page, and adds an opt-in **Reload before recording** setting for users who want strict record/replay parity.
- **[Fix prompt](./fix-prompt)** — click any element on the page, type what to change, get a precise prompt (source line:col + ancestor chain + Playwright selector) on your clipboard.

## Output

- **[Save as Spec](./save-as-spec)** ✨ UPDATED (v0.13) — `__vibe_tests__/<slug>.spec.ts` using `getByRole / getByLabel / getByTestId`. Runs in CI without Hover. v0.13 wraps every interaction in a visibility prelude (`{ const el = …; await expect(el).toBeVisible(); await el.<action>; }`) so UI drift fails in ~3 s with `Locator expected to be visible` instead of a 30 s actionability timeout.
- **[Save as Skill](./save-as-skill)** — `.claude/skills/<slug>/SKILL.md`. Replay by saying `execute <slug>`.
- **[Save as Jira case](./save-as-jira-case)** — `.case.csv`, imports straight into Jira / Xray / Zephyr.
- **[Save as Security spec](./security-spec)** — `__vibe_tests__/<slug>.security.spec.ts` using Playwright's `request` fixture. Crystallises authz / IDOR / parameter-tampering probes into CI-runnable regression specs. Requires `@hover-dev/security`.
- **[Findings cards](./findings-cards)** — bugs and observations the agent flagged, severity-coloured. First-class output, not buried in narration.
