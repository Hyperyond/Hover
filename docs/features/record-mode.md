# Record mode

Toggle **● Record** in the footer, do the flow manually, get the same step sequence as if the agent had driven it. While recording, the sub-toolbar lets you switch what the next click captures:

- **● Record** — record the click / fill / select as a Playwright step (default)
- **✓ Exists** — check the element appears: `expect(SEL).toBeVisible()`
- **¶ Says** — check the element's text matches: `expect(SEL).toHaveText("…")`
- **= Equals** — check an input / select / checkbox's current value

Check modes are one-shot — after the click commits the assertion, you snap back to Record. The same Save card downstream takes everything: actions and checks bake into the same `.spec.ts`. The downstream save path doesn't care whether the steps came from a human or from Claude.
