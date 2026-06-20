/**
 * The hover-control actuation tools that produce a CRYSTALLIZABLE step — exactly
 * the set `translateStep` (specs/writeSpec.ts) turns into a deterministic
 * grounded selector.
 *
 * Two places number actuation steps and MUST agree:
 *   1. `actuateServer.ts` increments a per-run counter once per call to one of
 *      these tools and echoes "· step N" to the agent, so the agent can refer to
 *      a flow's steps by number when it calls `record_candidate`.
 *   2. `service.ts` numbers the run's recorded steps by the SAME set to resolve a
 *      QA candidate's step numbers back to the actual recorded SkillSteps (which
 *      is what makes the crystallized candidate spec record==replay).
 * Both invocations and recorded steps are 1:1 and in order (one tool_use →
 * one recorded step), so positional numbering over this set lines up.
 */
export const ACTUATION_TOOLS = [
  'click_control',
  'fill_control',
  'select_control',
  'check_control',
  'upload_file',
] as const;

/** True if a recorded step's tool is a crystallizable hover-control actuation
 *  (accepts the raw `mcp__hover-control__*` name or the bare name). */
export function isActuationStep(rawTool: string | undefined): boolean {
  if (!rawTool) return false;
  const bare = rawTool.replace(/^mcp__[a-z0-9_-]+?__/, '');
  return (ACTUATION_TOOLS as readonly string[]).includes(bare);
}
