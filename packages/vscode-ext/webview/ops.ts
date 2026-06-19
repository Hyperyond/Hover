/**
 * Browser/MCP op → one human line, plus the "quiet" and "coalesce" predicates.
 * Ported verbatim from the legacy webview script so the run thread reads the
 * same. Past-tense only (the React thread renders settled history).
 */
const OPVERB: Record<string, [string, string]> = {
  click_control: ["Clicking", "Clicked"],
  browser_click: ["Clicking", "Clicked"],
  fill_control: ["Filling", "Filled"],
  browser_type: ["Typing into", "Typed into"],
  select_control: ["Selecting", "Selected"],
  browser_select_option: ["Selecting", "Selected"],
  check_control: ["Checking", "Checked"],
  browser_navigate: ["Navigating to", "Navigated to"],
  browser_navigate_back: ["Going back", "Went back"],
  browser_snapshot: ["Looking at the page", "Looked at the page"],
  browser_take_screenshot: ["Capturing a screenshot", "Captured a screenshot"],
  browser_press_key: ["Pressing", "Pressed"],
  browser_hover: ["Hovering", "Hovered"],
  browser_drag: ["Dragging", "Dragged"],
  browser_wait_for: ["Waiting", "Waited"],
  browser_tabs: ["Switching tabs", "Switched tabs"],
  browser_evaluate: ["Running a script", "Ran a script"],
  browser_fill_form: ["Filling the form", "Filled the form"],
};
const FILLISH = new Set(["fill_control", "select_control", "browser_select_option", "browser_type"]);
const BARE = new Set([
  "browser_snapshot", "browser_navigate_back", "browser_take_screenshot",
  "browser_fill_form", "browser_drag", "browser_wait_for", "browser_tabs", "browser_evaluate",
]);
const QUIET = new Set(["browser_snapshot", "browser_take_screenshot", "browser_wait_for", "mark_flow"]);
const NAV_KEYS = new Set(["pagedown", "pageup", "end", "home", "escape"]);

const strip = (tool?: string) => (tool || "").replace(/^mcp__.*?__/, "");
function parse(detail?: string): Record<string, unknown> {
  try {
    return detail ? (JSON.parse(detail) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface StepMsg {
  tool?: string;
  detail?: string;
  label?: string;
  isError?: boolean;
}

export function isQuietStep(m: StepMsg): boolean {
  const t = strip(m.tool);
  if (QUIET.has(t)) return true;
  if (t === "browser_press_key") {
    const k = String((parse(m.detail).key as string) || "").toLowerCase();
    if (NAV_KEYS.has(k) || k.startsWith("arrow")) return true;
  }
  return false;
}

/** Past-tense one-liner for an op (e.g. `Clicked "Sign in"`, `Navigated to /x`). */
export function describeOp(tool?: string, detail?: string): string {
  const t = strip(tool);
  const d = parse(detail);
  const name = (d.name || d.text || d.element || "") as string;
  const val = d.value !== undefined && d.value !== null && d.value !== "" ? String(d.value) : "";
  const pair = OPVERB[t];
  if (!pair) {
    const h = t.split("_").join(" ");
    return h.charAt(0).toUpperCase() + h.slice(1);
  }
  const verb = pair[1];
  if (t === "browser_navigate") return verb + (d.url ? " " + String(d.url) : "");
  if (t === "browser_press_key") return verb + (d.key ? " " + String(d.key) : "");
  if (BARE.has(t)) return verb;
  if (FILLISH.has(t)) {
    const lbl = name ? " " + name : " a field";
    return verb + lbl + (val ? " → " + val : "");
  }
  return verb + (name ? ` "${name}"` : "");
}

export function coalesceKind(tool?: string): "source" | null {
  const t = strip(tool);
  return t === "read_source" || t === "list_source" ? "source" : null;
}

/** Short path-ish line for a grouped (coalesced) op when expanded. */
export function groupDetail(m: StepMsg): string {
  const d = parse(m.detail);
  return String(d.path || d.file || d.dir || d.subdir || d.query || d.name || describeOp(m.tool, m.detail));
}

export const GROUP_LABEL: Record<string, string> = { source: "Read source" };
