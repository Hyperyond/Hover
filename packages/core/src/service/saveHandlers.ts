/**
 * Save-artifact WebSocket handlers (spec / Jira CSV).
 *
 * Both save-* messages share the same shape: validate `name + steps`, call a
 * per-kind writer, fork on Exists-error vs. success. The differences (which
 * writer, which message names, which fields to pluck) are captured in the
 * `SaveArtifactConfig` descriptor table below. (Save-as-Skill was retired; the
 * generic `onSaved` hook it used is kept for any future artifact that needs a
 * post-write tail.)
 */

import type { WebSocket } from 'ws';
import { type SkillStep } from '../specs/specStep.js';
import { writeSpec, SpecExistsError, type SpecAssertion } from '../specs/writeSpec.js';
import { send, type ClientMessage } from './types.js';

interface SaveArtifactConfig<TWriteResult extends { slug: string; path: string }> {
  /** Used in error messages. Mirrors the WS `type` the client sent. */
  requestName: string;
  /** Emitted on success. */
  savedType: string;
  /** Emitted when the writer threw an Exists-error. */
  existsType: string;
  /** Optional — fires after a successful write (e.g. to push a refreshed list
   *  to the widget). Currently unused; kept generic for future artifacts. */
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

  let result: TWriteResult;
  try {
    result = await cfg.write({
      devRoot, name, description, steps, assertions,
      payload: msg.payload!, overwrite,
    });
  } catch (err) {
    if (err instanceof cfg.ExistsError) {
      send(ws, { type: cfg.existsType, payload: { slug: err.slug, existingPath: err.path } });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    send(ws, { type: 'error', payload: { message: `${cfg.requestName} failed: ${message}` } });
    return;
  }
  send(ws, { type: cfg.savedType, payload: { name: result.slug, path: result.path } });
  // The artifact is already on disk; an onSaved failure (e.g. a follow-up
  // list re-scan) shouldn't surface as if the save itself failed — log on.
  if (cfg.onSaved) {
    try {
      await cfg.onSaved(ws, devRoot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[hover] ${cfg.requestName} onSaved failed: ${message}`);
    }
  }
}

export const SPEC_CONFIG: SaveArtifactConfig<Awaited<ReturnType<typeof writeSpec>>> = {
  requestName: 'save-spec',
  savedType: 'spec-saved',
  existsType: 'spec-exists',
  ExistsError: SpecExistsError,
  write: ({ devRoot, name, description, steps, assertions, payload, overwrite }) =>
    writeSpec({ devRoot, name, description, steps, assertions, overwrite, redactions: payload.redactions }),
};

