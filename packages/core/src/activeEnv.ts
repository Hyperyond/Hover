/**
 * The active-environment marker — `.hover/active.json`.
 *
 * The VS Code extension records which environment is active (its URL); the MCP
 * server reads it so a test / heal drive targets the SAME environment the user
 * picked, instead of a fixed HOVER_TARGET. Machine-local + gitignored (it's a
 * per-checkout choice, not shared knowledge), so it never travels with the repo.
 *
 * Deliberately holds NO secrets — just the environment id / name / URL and the
 * account env-var NAMES. Credentials come from `.hover/.env` (dotenv) or the
 * process env, never from here.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface ActiveEnv {
  /** Environment id (e.g. `local`, `staging`). */
  id: string;
  /** Display name. */
  name: string;
  /** Base URL a run/heal targets. */
  url: string;
  /** Account env-var names available for this env (HOVER_<LABEL>_USER/PASS) —
   *  names only, so the drive knows which creds to expect from the env/.env. */
  accountEnvVars?: string[];
}

export function activeEnvPath(devRoot: string): string {
  return join(devRoot, '.hover', 'active.json');
}

/** Read the active environment, or null when unset / unreadable / malformed. */
export function readActiveEnv(devRoot: string): ActiveEnv | null {
  try {
    const raw = JSON.parse(readFileSync(activeEnvPath(devRoot), 'utf8')) as Partial<ActiveEnv>;
    if (!raw || typeof raw.url !== 'string' || !raw.url) return null;
    return {
      id: typeof raw.id === 'string' ? raw.id : 'local',
      name: typeof raw.name === 'string' ? raw.name : (raw.id ?? 'local'),
      url: raw.url,
      accountEnvVars: Array.isArray(raw.accountEnvVars) ? raw.accountEnvVars.filter((s) => typeof s === 'string') : undefined,
    };
  } catch {
    return null;
  }
}

/** Write the active environment marker (best-effort; creates `.hover/`). */
export function writeActiveEnv(devRoot: string, env: ActiveEnv): void {
  const p = activeEnvPath(devRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(env, null, 2)}\n`, 'utf8');
}
