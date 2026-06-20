/**
 * Built-in (non-plugin) mode behavior. Hover's core modes — Flow (the default,
 * modeId `null`) and the planned QA mode — are pure agent-behavior config: which
 * actuation tools the agent uses and how a run crystallizes. (Plugin modes —
 * api-test / pentest — bring runtime machinery instead: a MITM proxy, sidecars,
 * Chrome proxy flags, lifecycle hooks; they resolve to PLUGIN_MODE_BEHAVIOR.)
 *
 * `resolveModeBehavior(modeId)` is the SINGLE place that answers "how does this
 * mode drive the agent", replacing scattered `currentModeId === null` checks.
 * Adding a built-in mode (e.g. QA) = one entry in BUILTIN_MODE_BEHAVIOR, not new
 * conditionals threaded through the run-assembly path.
 */
export interface ModeBehavior {
  /** Deny Playwright's loose interaction tools (browser_click / type / fill_form
   *  / select_option / file_upload) AND inject the grounded-actuation directive,
   *  so the agent actuates via the Hover control MCP and saved selectors are
   *  role+name (record == replay). Flow and QA want this — they crystallize
   *  browser steps; plugin modes don't — they explore to capture traffic and
   *  keep the Playwright tools. */
  groundedActuation: boolean;
}

/** Flow — the default mode (modeId `null`): author a Playwright spec via grounded
 *  actuation. */
const FLOW_MODE_BEHAVIOR: ModeBehavior = { groundedActuation: true };

/** Built-in modes other than Flow, keyed by modeId.
 *  QA = comprehensive testing umbrella; its Functional capability reuses Flow's
 *  grounded actuation (record == replay for promoted candidate flows). (Its API
 *  capability — when enabled — delegates to the api-test plugin's MITM runtime;
 *  that orchestration is a later QA stage, not a ModeBehavior field.) */
const BUILTIN_MODE_BEHAVIOR: Record<string, ModeBehavior> = {
  qa: { groundedActuation: true },
};

/** Plugin-contributed modes (api-test / pentest): full Playwright tool access —
 *  they explore to capture traffic, not to crystallize browser steps. */
const PLUGIN_MODE_BEHAVIOR: ModeBehavior = { groundedActuation: false };

/** Resolve the agent-behavior config for a mode id (null = Flow). Built-in modes
 *  are table-driven; any other (plugin) id falls back to PLUGIN_MODE_BEHAVIOR. */
export function resolveModeBehavior(modeId: string | null): ModeBehavior {
  if (modeId === null) return FLOW_MODE_BEHAVIOR;
  return BUILTIN_MODE_BEHAVIOR[modeId] ?? PLUGIN_MODE_BEHAVIOR;
}

/** Picker metadata for built-in non-Flow modes (Flow is the implicit null
 *  default, not listed). core's broadcastModes merges these into the mode
 *  catalogue alongside plugin-contributed modes, and switchMode/set-mode accept
 *  them without requiring a plugin. */
export interface BuiltinMode {
  id: string;
  label: string;
  description: string;
  accent: string;
}
export const BUILTIN_MODES: BuiltinMode[] = [
  {
    id: 'qa',
    label: 'QA Testing',
    description: 'explore the whole app → findings report + promotable specs',
    accent: '#22c55e',
  },
];

/** True for a built-in non-null mode id (currently just `qa`). Lets core accept
 *  it in set-mode / switchMode without a contributing plugin. */
export function isBuiltinMode(modeId: string): boolean {
  return modeId in BUILTIN_MODE_BEHAVIOR;
}
