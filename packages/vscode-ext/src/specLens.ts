/**
 * F3 (slice) — spec-lifecycle CodeLens.
 *
 * Adds Hover-unique CodeLenses to the top of crystallized spec files
 * (`*.spec.ts` and `*.api-test.spec.ts`). It deliberately does NOT add a
 * Run/Debug lens — the official Playwright extension owns running specs, and
 * Hover coexists with it (design non-goal N1). What's Hover-specific:
 *
 *   • "✨ Review optimization candidate" — shown only when a candidate draft
 *     exists at `.hover/cache/optimized/<spec>.draft`; runs F1's diff command.
 *   • the stamped "Original prompt:" line — Hover signs every spec with the NL
 *     intent it was authored from; surfaced as an informational (non-clickable)
 *     lens so the spec's provenance is visible at a glance.
 */
import * as vscode from 'vscode';
import { candidateUri, uriExists } from './optimized.js';

/** How many lines of the JSDoc header to scan for the stamped prompt. */
const HEADER_SCAN_LINES = 40;

export class SpecLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];
    const topRange = new vscode.Range(0, 0, 0, 0);

    const prompt = extractOriginalPrompt(document, HEADER_SCAN_LINES);
    if (prompt) {
      // No command → renders as plain, non-clickable provenance text.
      lenses.push(new vscode.CodeLens(topRange, { title: `✨ Hover spec — "${prompt}"`, command: '' }));
    }

    const candidate = candidateUri(document.uri);
    if (candidate && (await uriExists(candidate))) {
      lenses.push(
        new vscode.CodeLens(topRange, {
          title: '✨ Review optimization candidate',
          command: 'hover.reviewOptimizationCandidate',
          arguments: [document.uri],
        }),
      );
    }

    return lenses;
  }
}

/** Pull the `Original prompt:` value Hover stamps into the spec's JSDoc header. */
export function extractOriginalPrompt(document: vscode.TextDocument, scanLines: number): string | null {
  const max = Math.min(scanLines, document.lineCount);
  for (let i = 0; i < max; i++) {
    const m = /Original prompt:\s*(.+?)\s*$/.exec(document.lineAt(i).text);
    if (m) {
      const text = m[1].trim();
      return text.length > 80 ? text.slice(0, 77) + '…' : text;
    }
  }
  return null;
}
