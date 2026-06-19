/**
 * Dev-only preview seed. When the app runs in a plain browser (Vite dev server,
 * no VS Code host) it receives no run messages, so the thread would only ever
 * show the splash. This streams a sample run via window.postMessage so the run
 * thread (narration / ops / source group / result) is visible while iterating.
 *
 * Never runs in the packaged extension: gated on Vite's DEV flag AND the absence
 * of the real `acquireVsCodeApi`.
 */
export function maybeSeedDevThread(): void {
  const isDev = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  if (!isDev || typeof acquireVsCodeApi === "function") return;

  const seq: Record<string, unknown>[] = [
    { type: "appstatus", online: true, label: "localhost:5173" },
    { type: "user", text: "test the login flow" },
    { type: "narration", text: "I'll open the app and sign in with the demo account." },
    { type: "step", tool: "browser_navigate", detail: JSON.stringify({ url: "http://localhost:5173/" }) },
    { type: "step", tool: "mcp__hovercontrol__fill_control", detail: JSON.stringify({ name: "Email", value: "demo@example.com" }) },
    { type: "step", tool: "mcp__hovercontrol__fill_control", detail: JSON.stringify({ name: "Password", value: "•••••" }) },
    { type: "step", tool: "mcp__hovercontrol__click_control", detail: JSON.stringify({ name: "Sign in" }) },
    { type: "narration", text: "Reading the route components to ground the selectors." },
    { type: "step", tool: "mcp__hoversource__read_source", detail: JSON.stringify({ path: "src/Login.tsx" }) },
    { type: "step", tool: "mcp__hoversource__list_source", detail: JSON.stringify({ dir: "src/routes" }) },
    { type: "step", tool: "mcp__hoversource__read_source", detail: JSON.stringify({ path: "src/routes/home.tsx" }) },
    { type: "narration", text: "Verifying the dashboard rendered after login." },
    { type: "step", tool: "mcp__hovercontrol__click_control", detail: JSON.stringify({ name: "Dashboard" }) },
    {
      type: "result",
      verdict: "Done",
      summary:
        "Logged in with the demo account and landed on the dashboard.\n\n## Findings\n- Minor — the email field has no `aria-label`.\n- Info — login took ~1.2s.",
      steps: 7,
      tokens: 1840,
    },
  ];

  let i = 0;
  const tick = () => {
    if (i < seq.length) {
      window.postMessage(seq[i++], "*");
      setTimeout(tick, 450);
    }
  };
  setTimeout(tick, 500);
}
