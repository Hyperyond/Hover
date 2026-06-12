/**
 * Page Object manifest — the link between extraction (Stage 3b) and
 * consumption (Stage 3c).
 *
 * extractPageObjects writes `.hover/page-objects.json` describing each emitted
 * Page Object: its class/method/fixture names and the signature prefix it
 * replays. writeSpec reads it to decide whether a freshly-saved spec's prefix
 * matches a Page Object — if so it consumes `await loginPage.login(…)` and
 * imports from `./fixtures` instead of re-emitting the steps inline.
 *
 * Kept separate from extractPageObjects so writeSpec can read the manifest
 * without importing the detection/generation chain.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sidecarDir, legacySidecarDir } from './sidecar.js';

export const MANIFEST_VERSION = 1;

export interface PageObjectEntry {
  className: string;
  methodName: string;
  /** Fixture key in fixtures.ts, e.g. `loginPage`. */
  fixtureName: string;
  fileName: string;
  /** The signature prefix this Page Object's method replays (one per step). */
  signatures: string[];
  /** Slugs of the specs the Page Object was lifted from. */
  specs: string[];
}

export interface PageObjectManifest {
  version: number;
  pages: PageObjectEntry[];
}

function manifestPath(devRoot: string): string {
  return join(sidecarDir(devRoot), 'page-objects.json');
}

export async function writePageObjectManifest(
  devRoot: string,
  pages: PageObjectEntry[],
): Promise<string> {
  const dir = sidecarDir(devRoot);
  await mkdir(dir, { recursive: true });
  const path = manifestPath(devRoot);
  const manifest: PageObjectManifest = { version: MANIFEST_VERSION, pages };
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return path;
}

/** Read the manifest, or null when none exists (no extraction has run).
 *  Falls back to the legacy `__vibe_tests__/.hover/` home for manifests
 *  written before the `.hover/sidecars/` relocation. */
export async function readPageObjectManifest(devRoot: string): Promise<PageObjectManifest | null> {
  for (const path of [manifestPath(devRoot), join(legacySidecarDir(devRoot), 'page-objects.json')]) {
    try {
      const m = JSON.parse(await readFile(path, 'utf-8')) as PageObjectManifest;
      if (Array.isArray(m.pages)) return m;
    } catch {
      /* no manifest / malformed — try next */
    }
  }
  return null;
}
