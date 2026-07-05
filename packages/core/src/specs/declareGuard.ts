/**
 * Guard declaration — the RED light of guard-first development.
 *
 * `/mcp__hover__guard` turns a stated intent into three durable artifacts:
 * business rules (via record_fact), an UNCOVERED `- [ ]` line on the business
 * map, and that line's acceptance criteria (its `Note:`). This module writes
 * the map part DETERMINISTICALLY — the map is a contract parsed by the
 * extension cockpit and Hover Cloud, so the agent must not hand-edit its
 * syntax. The spec itself is still RECORDED later (crystallize), never
 * confabulated: declarative red, recorded green — record == replay intact.
 *
 * Idempotent: re-declaring the same line updates its Note in place. Total:
 * returns {error} instead of throwing (same contract as writeFact).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { hoverDir } from './sidecar.js';
import { ensureKnowledgeTracked } from '../memory/gitignore.js';

export interface GuardDeclaration {
  /** Map area (## section), e.g. "Practice". Created if absent. */
  area: string;
  /** Business-line name, e.g. "Daily check-in". */
  line: string;
  /** Entry route, e.g. "/checkin". */
  route?: string;
  /** Acceptance criteria — what the recorded spec must assert, in order. */
  criteria: string[];
}

const mapPath = (devRoot: string) => join(hoverDir(devRoot), 'hover-map.md');

/** `- [ ] Name — /route` matcher for one line entry, tolerant of dash style. */
function lineRe(name: string): RegExp {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^-\\s+\\[[ xX]\\]\\s+${esc}\\s*(?:[—–-]|$)`);
}

export async function declareGuard(
  devRoot: string,
  d: GuardDeclaration,
): Promise<{ path: string; created: boolean } | { error: string }> {
  try {
    const area = d.area.trim();
    const line = d.line.trim();
    if (!area || !line) return { error: 'area and line are both required' };
    const note = `  Note: acceptance = ${d.criteria.map((c) => c.trim()).filter(Boolean).join('; ')}`;
    const entry = `- [ ] ${line}${d.route?.trim() ? ` — ${d.route.trim()}` : ''}`;

    await mkdir(hoverDir(devRoot), { recursive: true });
    const path = mapPath(devRoot);
    let src = '';
    try {
      src = await readFile(path, 'utf-8');
    } catch {
      src = `# Business map — ${basename(devRoot)}\n`;
    }
    const lines = src.split('\n');

    // Locate the area section; create it if missing — INSERTED before the
    // Relationships/Notes tail sections so line areas stay contiguous.
    const areaIdx = lines.findIndex(
      (l) => l.match(/^##\s+(.+)$/)?.[1]?.trim().toLowerCase() === area.toLowerCase(),
    );
    let insertAt: number;
    let created = false;
    if (areaIdx === -1) {
      const tailIdx = lines.findIndex((l) => /^##\s+(Relationships|Notes)\s*$/i.test(l));
      const at = tailIdx === -1 ? lines.length : tailIdx;
      const block = [`## ${area}`, entry, note, ''];
      lines.splice(at, 0, ...block);
      created = true;
      insertAt = -1; // done
    } else {
      // Area exists — find this line inside it (up to the next ## or EOF).
      let sectionEnd = lines.length;
      for (let i = areaIdx + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i])) {
          sectionEnd = i;
          break;
        }
      }
      const re = lineRe(line);
      let lineIdx = -1;
      for (let i = areaIdx + 1; i < sectionEnd; i++) {
        if (re.test(lines[i])) {
          lineIdx = i;
          break;
        }
      }
      if (lineIdx === -1) {
        // Append the entry at the end of the section's list (before a blank
        // tail if present) — the pending contract, visible as a gap.
        let at = sectionEnd;
        while (at > areaIdx + 1 && lines[at - 1].trim() === '') at--;
        lines.splice(at, 0, entry, note);
        created = true;
      } else {
        // Re-declaration: refresh the Note (insert or replace the indented
        // Note line directly under the entry). The [ ]/[x] state is NOT
        // touched — coverage truth belongs to crystallize/lint, not here.
        const noteIdx = lineIdx + 1;
        if (noteIdx < sectionEnd && /^\s{2,}-?\s*Note:/.test(lines[noteIdx] ?? '')) {
          lines[noteIdx] = note;
        } else {
          lines.splice(noteIdx, 0, note);
        }
      }
      insertAt = -1;
    }
    void insertAt;

    await writeFile(path, lines.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf-8');
    await ensureKnowledgeTracked(devRoot);
    return { path, created };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
