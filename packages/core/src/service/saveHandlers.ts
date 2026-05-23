/**
 * Save-artifact WebSocket handlers (skill / spec / Jira CSV).
 *
 * All three save-* messages share the same shape: validate `name + steps`,
 * call a per-kind writer, fork on Exists-error vs. success. The differences
 * (which writer, which message names, which fields to pluck, skill's
 * "push a fresh skills-list afterwards" tail) are captured in the
 * `SaveArtifactConfig` descriptor table below.
 *
 * Replaces three near-identical handlers that drifted apart over time —
 * see the v0.2.x refactor pass for the full rationale.
 */

import type { WebSocket } from 'ws';
import { writeSkill, listSkills, SkillExistsError, type SkillStep } from '../skills/writeSkill.js';
import { writeSpec, SpecExistsError, type SpecAssertion } from '../specs/writeSpec.js';
import { writeCaseCsv, CaseCsvExistsError } from '../specs/writeCaseCsv.js';
import { send, type ClientMessage } from './types.js';

interface SaveArtifactConfig<TWriteResult extends { slug: string; path: string }> {
  /** Used in error messages. Mirrors the WS `type` the client sent. */
  requestName: string;
  /** Emitted on success. */
  savedType: string;
  /** Emitted when the writer threw an Exists-error. */
  existsType: string;
  /** Optional — fires after a successful write. Used by the skill flow to
   *  push a refreshed `skills-list` to the widget. */
  onSaved?: (ws: WebSocket, devRoot: string) => Promise<void>;
  /** Class used in `err instanceof …` to detect "already exists" errors. */
  ExistsError: new (...args: never[]) => { slug: string; path: string } & Error;
  /** Pluck the payload fields this artifact needs and call its writer. */
  write: (args: {
    devRoot: string;
    name: string;
    description: string;
    steps: SkillStep[];
    assertions: SpecAssertion[];
    payload: NonNullable<ClientMessage['payload']>;
    overwrite: boolean;
  }) => Promise<TWriteResult>;
}

export async function handleSaveArtifact<TWriteResult extends { slug: string; path: string }>(
  ws: WebSocket,
  msg: ClientMessage,
  devRoot: string,
  cfg: SaveArtifactConfig<TWriteResult>,
): Promise<void> {
  const name = msg.payload?.name;
  const description = msg.payload?.description ?? '';
  const steps = msg.payload?.steps;
  const assertions = msg.payload?.assertions ?? [];
  const overwrite = msg.payload?.overwrite === true;

  if (typeof name !== 'string' || !name.trim()) {
    send(ws, { type: 'error', payload: { message: `${cfg.requestName}: name is required` } });
    return;
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    send(ws, { type: 'error', payload: { message: `${cfg.requestName}: no steps to save` } });
    return;
  }

  try {
    const result = await cfg.write({
      devRoot, name, description, steps, assertions,
      payload: msg.payload!, overwrite,
    });
    send(ws, { type: cfg.savedType, payload: { name: result.slug, path: result.path } });
    if (cfg.onSaved) await cfg.onSaved(ws, devRoot);
  } catch (err) {
    if (err instanceof cfg.ExistsError) {
      send(ws, { type: cfg.existsType, payload: { slug: err.slug, existingPath: err.path } });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    send(ws, { type: 'error', payload: { message: `${cfg.requestName} failed: ${message}` } });
  }
}

export const SKILL_CONFIG: SaveArtifactConfig<Awaited<ReturnType<typeof writeSkill>>> = {
  requestName: 'save-skill',
  savedType: 'skill-saved',
  existsType: 'skill-exists',
  ExistsError: SkillExistsError,
  write: ({ devRoot, name, description, steps, overwrite }) =>
    writeSkill({ devRoot, name, description, steps, overwrite }),
  onSaved: async (ws, devRoot) => {
    // Push a fresh list so the widget's skills overlay updates without a
    // round-trip — most relevant right after the save.
    const skills = await listSkills(devRoot);
    send(ws, { type: 'skills-list', payload: { skills } });
  },
};

export const SPEC_CONFIG: SaveArtifactConfig<Awaited<ReturnType<typeof writeSpec>>> = {
  requestName: 'save-spec',
  savedType: 'spec-saved',
  existsType: 'spec-exists',
  ExistsError: SpecExistsError,
  write: ({ devRoot, name, description, steps, assertions, overwrite }) =>
    writeSpec({ devRoot, name, description, steps, assertions, overwrite }),
};

export const CASE_CSV_CONFIG: SaveArtifactConfig<Awaited<ReturnType<typeof writeCaseCsv>>> = {
  requestName: 'save-case-csv',
  savedType: 'case-csv-saved',
  existsType: 'case-csv-exists',
  ExistsError: CaseCsvExistsError,
  write: ({ devRoot, name, description, steps, assertions, payload, overwrite }) =>
    writeCaseCsv({
      devRoot, name, description, steps, assertions,
      jiraProjectKey: payload.jiraProjectKey,
      labels: payload.labels,
      overwrite,
    }),
};
