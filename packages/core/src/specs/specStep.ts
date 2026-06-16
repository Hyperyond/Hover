/**
 * The serialized captured-step shape the whole spec pipeline (writeSpec,
 * sidecar, Page-Object extraction, the session record) consumes.
 *
 * One entry per recorded chat message: a user prompt, an agent narration, a
 * `browser_*` / control-MCP tool call (`step`), or the terminal `done` summary.
 * (Formerly `SkillStep` in specs/specStep.ts, back when a run could be saved
 * as a `.claude/skills/<slug>/SKILL.md` — that feature was retired; only the
 * type survived, now relocated here.)
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
