# Fix prompt

A separate **⌖ Fix** button next to Record. Click it, click any element on the page, type *what you'd like to change*, and Hover assembles a precise prompt onto your clipboard. Paste into Cursor / Claude Code / Windsurf and the agent has exact context.

The widget knows the source location of every host element on your page — a Vite transform stamps `data-hover-source="file:line:col"` onto every `<button>` / `<div>` / `<input>` you authored in JSX.

## Example

```
Change this element in my app:

> Make this button red and add a loading spinner on click

Element: <button> — "Add to cart"
Source of likely target: src/components/ShadcnButton.tsx:42:11
Ancestor sources (closer ancestors first):
  • <div> @ src/routes/Cart.tsx:71:6
  • <section> @ src/routes/Cart.tsx:64:4
  • <main> @ src/App.tsx:11:6
React component chain (innermost first): ShadcnButton → CartLineItem → Cart → App
Playwright selector: page.getByRole("button", { name: "Add to cart" })
Outer HTML:
  <button data-hover-source="src/components/ShadcnButton.tsx:42:11" class="btn-primary">Add to cart</button>
```

The prompt is **fact-only** — no leading instructions for the agent to echo back, no "please open the right file" boilerplate. Just your intent (as a markdown blockquote) followed by what Hover observed.

::: info This page is a placeholder
Full content coming soon — including details on the likely-target descent (click a `<div>` wrapping a button → prompt auto-points to the inner button) and the DOM ancestor chain that catches wrapper-rendered hosts like styled-components / Radix Slot.
:::
