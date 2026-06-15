/**
 * Captured-step type.
 *
 * @deprecated MODULE SLATED FOR REMOVAL. Save-as-Skill (writing
 * `.claude/skills/<slug>/SKILL.md` for agent replay) was retired — `spec` +
 * Self-healing (⟳ Re-record) covers intent-driven replay, and "skill" collided
 * with Claude Code's own skills concept. All that remains here is `SkillStep`:
 * the serialized captured-step shape the whole spec pipeline (writeSpec,
 * sidecar, listSpecs, Page-Object extraction) consumes as `SpecStep`.
 *
 * TODO(cleanup): relocate `SkillStep` to a neutral module (e.g.
 * `specs/specStep.ts`) and update the `import … from '../skills/writeSkill.js'`
 * call sites, then delete this file. The path is kept for now only so those
 * call sites don't churn ahead of that one mechanical pass.
 */

/**
 * Serialized message shape from the widget's localStorage. Matches the
 * `state.messages` schema in packages/widget-bootstrap/src/widget/client.js.
 */
export interface SkillStep {
  kind: 'user' | 'system' | 'step' | 'ai' | 'done';
  text?: string;
  tool?: string;
  input?: unknown;
  isError?: boolean;
  turns?: number;
  costUsd?: number;
  summary?: string;
}
