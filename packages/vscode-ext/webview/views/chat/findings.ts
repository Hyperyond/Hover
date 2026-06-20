/**
 * Findings rows for the result block — ported from the legacy webview so they
 * render with the same `.finding` + `.badge` markup the CSS expects. Handles
 * both structured findings (objects) and a free-form severity-prefixed text run.
 */
import { inline } from "../../shared/markdown";
import type { Finding } from "./useThread";

export interface FindingRow {
  word: string | null;
  html: string;
}

function badgeWord(marker?: string | null): string | null {
  if (!marker) return null;
  const m = marker.trim();
  return m.length <= 12 && !/\s.*\s/.test(m) ? m : null; // ≤12 chars, ≤1 space
}

export function sevClass(word: string | null): string {
  const s = (word || "").toLowerCase();
  if (s === "bug" || s === "major" || s === "high" || s === "critical" || /严重|高危|高/.test(s)) return "bug";
  if (s === "info" || s === "note" || /提示|信息/.test(s)) return "info";
  return "minor";
}

export function structuredRows(arr: Finding[]): FindingRow[] {
  return arr
    .filter((f) => f && (f.text || f.title))
    .map((f) => {
      const word = badgeWord(f.severity);
      const body = f.title && f.title !== f.text ? `**${f.title}** — ${f.text || ""}` : f.text || f.title || "";
      const ep = f.method || f.endpoint ? ` \`${[f.method, f.endpoint].filter(Boolean).join(" ")}\`` : "";
      return { word, html: inline(body + ep) };
    });
}

export function textRows(text: string): FindingRow[] {
  const rows: FindingRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let marker: string | null = null;
    let rest: string | null = null;
    const sv = line.match(
      /^\s*(?:[-*]\s*)?\**\s*(critical|high|medium|low|bug|major|minor|issue|warning|vuln(?:erability)?|security|note|info)\b\s*\**\s*[—–:-]\s*([\s\S]+)$/i,
    );
    const b = line.match(/^\s*[-*]\s+(?:\*\*\s*([^*]+?)\s*\*\*\s*[—–:-]?\s*)?([\s\S]+)$/);
    if (sv) {
      marker = sv[1];
      rest = sv[2];
    } else if (b) {
      marker = b[1];
      rest = b[2];
    } else {
      rest = line.trim();
    }
    const word = badgeWord(marker);
    if (!word && marker) rest = `**${marker}** ${rest}`;
    rows.push({ word, html: inline(rest || "") });
  }
  return rows;
}
