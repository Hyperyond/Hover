# Findings cards

The agent's verification report and any bugs it finds get their own cards at the end of the run — separate from the step-by-step timeline.

The **Result card** holds the narrative summary (PASS / FAIL + steps the agent took). The **Findings card** lists every `## Bug` / `## Minor` / `## Note` the agent flagged, severity-coloured.

Hover's system prompt teaches the agent to emit this structured block at the end of every run, so QA reading the saved spec can scan the bug list without scrolling through tool calls.

::: info This page is a placeholder
Full content coming soon, including the Findings markdown grammar Hover parses (`extractFindings` in `reducer.js`) and how each severity tier maps to a colour and an icon.
:::

![Findings card](/07-findings-card.png)
