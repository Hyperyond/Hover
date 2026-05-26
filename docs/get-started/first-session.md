# Your first session

Walk through the basic-app login flow end-to-end. Estimated time: 5 minutes.

## Prerequisites

- Followed [Quick start](./quick-start) — `pnpm dev:example:basic-app` is running, debug Chrome is open on port 9222.
- The Hover widget is visible in the bottom-right of <http://localhost:5173/>.

## Step 1 — Open the widget

Click the ✨ launcher. The panel slides up.

You'll see:
- A header pill `claude ▾` showing the active coding agent
- A status indicator (`connected` when the WS bridge is up)
- An empty conversation body
- A footer with a textarea, **Record**, **⌖ Fix**, **Send**, and a round 🎙 mic button

## Step 2 — Send your first prompt

Type:

```
log in, then click + 1 three times and verify the counter, then add a todo named "verify hover"
```

Press <kbd>↵</kbd> or click **Send**. The button switches to **Stop** while the agent runs.

::: tip Try Voice mode
Or hold the round 🎙 button to the right of Send and *speak* the same instruction. Hover transcribes it into the textarea and submits on release. Works in 中文 too — [learn more](/features/voice-mode).
:::

## Step 3 — Watch the agent drive

Events stream into the panel as the agent works:
- `Opening page` / `Clicking …` / `Filling form` — tool calls, one row per natural-language intent
- Mint-bar spinner on the currently-running step
- Running cost ($) ticks in the header

The agent's verification report renders as a Result card at the end. If it found bugs, a Findings card appears alongside, severity-coloured.

## Step 4 — Save the verified session

Click the dropdown on the Result card. Three formats:

- **Save as Spec** → `__vibe_tests__/<slug>.spec.ts` using `getByRole` / `getByLabel` / `getByTestId`
- **Save as Skill** → `.claude/skills/<slug>/SKILL.md` (replayable by saying "execute &lt;slug&gt;")
- **Save as Jira case** → `__vibe_tests__/<slug>.case.csv` (Xray-compatible)

## Step 5 — Run the spec without Hover

```bash
pnpm --filter basic-app exec playwright test __vibe_tests__/<slug>.spec.ts
```

This is the point of crystallization: the AI authored the test once, but the saved spec runs forever in CI with zero agent involvement.

## What's next

- [Voice mode](/features/voice-mode) — hands-free instruction and step narration
- [Record mode](/features/record-mode) — record your own clicks as Playwright steps
- [Fix prompt](/features/fix-prompt) — click an element, describe a change, get a precise prompt
