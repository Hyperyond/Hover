/**
 * Minimal, safe markdown → HTML (escape first, then a few constructs), plus the
 * findings splitter. Ported from the legacy webview so the result block renders
 * the same. Output is used with dangerouslySetInnerHTML (escaped up front).
 */
export function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function inline(t: string): string {
  return esc(t)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function mdToHtml(md: string): string {
  if (!md) return "";
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      const cells = rows.map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      let html = "<table>";
      let start = 0;
      if (cells[1] && cells[1].every((c) => /^:?-{2,}:?$/.test(c))) {
        html += "<tr>" + cells[0].map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr>";
        start = 2;
      }
      for (let r = start; r < cells.length; r++) {
        html += "<tr>" + cells[r].map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>";
      }
      out.push(html + "</table>");
      continue;
    }
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      out.push("<h4>" + inline(hm[2]) + "</h4>");
      i++;
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push("<hr/>");
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push("<li>" + inline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>");
        i++;
      }
      out.push("<ul>" + items.join("") + "</ul>");
      continue;
    }
    if (line.trim() === "") {
      out.push("");
      i++;
      continue;
    }
    out.push("<div>" + inline(line) + "</div>");
    i++;
  }
  return out.join("");
}

/** Pull a findings block out of a free-form summary (heading or severity-prefixed
 *  run), leaving the rest as `main`. */
export function splitFindings(s: string): { main: string; findings: string | null } {
  const lines = s.split("\n");
  const SEV =
    /^\s*(?:[-*]\s*)?\**\s*(critical|high|medium|low|bug|major|minor|issue|warning|vuln(?:erability)?|security|note|info)\b\s*\**\s*[—–:-]/i;
  let hi = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^#{1,6}\s*(findings|bugs|issues)\b/i.test(t) || /^findings\s*:/i.test(t)) {
      hi = i;
      break;
    }
  }
  if (hi >= 0) {
    let j = hi + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    const start = j;
    while (j < lines.length && (lines[j].trim() === "" || /^\s*[-*]\s+/.test(lines[j]) || SEV.test(lines[j]))) j++;
    const block = lines.slice(start, j).filter((l) => l.trim() !== "");
    const main = lines.slice(0, hi).concat(lines.slice(j)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return { main, findings: block.length ? block.join("\n") : null };
  }
  let fs = -1;
  for (let k = 0; k < lines.length; k++) {
    if (SEV.test(lines[k])) {
      fs = k;
      break;
    }
  }
  if (fs < 0) return { main: s, findings: null };
  let e = fs;
  const block2: string[] = [];
  while (e < lines.length) {
    if (lines[e].trim() === "") {
      let n = e + 1;
      while (n < lines.length && lines[n].trim() === "") n++;
      if (n < lines.length && SEV.test(lines[n])) {
        e = n;
        continue;
      }
      break;
    }
    if (SEV.test(lines[e])) {
      block2.push(lines[e]);
      e++;
    } else break;
  }
  const main2 = lines.slice(0, fs).concat(lines.slice(e)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { main: main2, findings: block2.length ? block2.join("\n") : null };
}
