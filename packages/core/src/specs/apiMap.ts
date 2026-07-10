/**
 * API layer on the business map — the second perspective.
 *
 * UI flows land on the map as business lines; the API CONTRACTS that
 * `crystallize_api_spec` locks (status / shape / authz per endpoint) were
 * invisible. This module upserts them into a conventional `## API` area:
 *
 *     ## API
 *     - [x] orders — POST /api/orders · GET /api/cart — orders.api-test.spec.ts
 *
 * DELIBERATELY zero new syntax: `## API` parses as a normal area and its
 * entries as covered lines in every existing parser (extension, core, Cloud).
 * Renderers recognize the `.api-test.spec.ts` suffix to badge/shape API nodes.
 * Written deterministically here (the map is a parsed contract — agents must
 * not hand-edit its syntax), called by the MCP right after writeApiSpec.
 *
 * Idempotent: re-crystallizing the same spec replaces its entry (matched by
 * spec filename — the stable identity; the display name may be re-derived).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { hoverDir } from './sidecar.js';
import { ensureKnowledgeTracked } from '../memory/gitignore.js';

const AREA = 'API';
const mapPath = (devRoot: string) => join(hoverDir(devRoot), 'hover-map.md');

export interface ApiMapEntry {
  /** Display name for the surface, e.g. the api-spec slug ("orders"). */
  name: string;
  /** Endpoints the spec locks, e.g. ["POST /api/orders", "GET /api/cart"]. */
  endpoints: string[];
  /** The spec file (basename or path — stored as basename). */
  specFile: string;
}

/** Compact `METHOD /path` endpoint labels from raw check URLs (absolute URLs
 *  are reduced to their pathname; unparseable values pass through). */
export function endpointLabel(method: string, url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname || url;
  } catch {
    /* already a path (or opaque) — keep as-is */
  }
  return `${method.toUpperCase()} ${path}`;
}

export async function recordApiOnMap(
  devRoot: string,
  entry: ApiMapEntry,
): Promise<{ path: string; created: boolean } | { error: string }> {
  try {
    const name = entry.name.trim();
    const spec = basename(entry.specFile.trim());
    if (!name || !spec) return { error: 'name and specFile are both required' };
    // De-dup endpoints, keep order, cap the line at a readable length.
    const endpoints = [...new Set(entry.endpoints.map((e) => e.trim()).filter(Boolean))];
    const shown = endpoints.slice(0, 6);
    const more = endpoints.length - shown.length;
    const mid = shown.length ? ` — ${shown.join(' · ')}${more > 0 ? ` · +${more} more` : ''}` : '';
    const line = `- [x] ${name}${mid} — ${spec}`;

    await mkdir(hoverDir(devRoot), { recursive: true });
    const path = mapPath(devRoot);
    let src = '';
    try {
      src = await readFile(path, 'utf-8');
    } catch {
      src = `# Business map — ${basename(devRoot)}\n`;
    }
    const lines = src.split('\n');

    const areaIdx = lines.findIndex(
      (l) => l.match(/^##\s+(.+)$/)?.[1]?.trim().toLowerCase() === AREA.toLowerCase(),
    );
    let created = false;
    if (areaIdx === -1) {
      // New `## API` area — before the Relationships/Notes tail so line areas
      // stay contiguous (same placement rule as declareGuard).
      const tailIdx = lines.findIndex((l) => /^##\s+(Relationships|Notes)\s*$/i.test(l));
      const at = tailIdx === -1 ? lines.length : tailIdx;
      lines.splice(at, 0, `## ${AREA}`, line, '');
      created = true;
    } else {
      let sectionEnd = lines.length;
      for (let i = areaIdx + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i])) {
          sectionEnd = i;
          break;
        }
      }
      // Identity = the spec filename (names can be re-derived across runs).
      const specEsc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^-\\s+\\[[ xX]\\]\\s+.*${specEsc}\\s*$`);
      let lineIdx = -1;
      for (let i = areaIdx + 1; i < sectionEnd; i++) {
        if (re.test(lines[i])) {
          lineIdx = i;
          break;
        }
      }
      if (lineIdx === -1) {
        let at = sectionEnd;
        while (at > areaIdx + 1 && lines[at - 1].trim() === '') at--;
        lines.splice(at, 0, line);
        created = true;
      } else {
        lines[lineIdx] = line; // refresh endpoints in place
      }
    }

    await writeFile(path, lines.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf-8');
    await ensureKnowledgeTracked(devRoot);
    return { path, created };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
