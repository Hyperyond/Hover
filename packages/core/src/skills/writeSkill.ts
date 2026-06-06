/**
 * Captured-step type.
 *
 * NOTE: Save-as-Skill (writing `.claude/skills/<slug>/SKILL.md` for agent
 * replay) was retired — `spec` + ⟳ Re-record covers intent-driven replay, and
 * "skill" collided with Claude Code's own skills concept. All that remains
 * here is `SkillStep`: the serialized message shape from the widget's
 * localStorage, which the whole spec pipeline (writeSpec, sidecar, listSpecs,
 * Page-Object extraction) consumes as `SpecStep`. The file keeps its path so
 * the many `import { SkillStep } from '../skills/writeSkill.js'` call sites
 * don't churn; renaming to a neutral module is a separate mechanical pass.
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
