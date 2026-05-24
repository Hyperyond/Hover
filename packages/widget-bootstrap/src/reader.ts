import { readFileSync, statSync } from 'node:fs';

type Transform = (raw: string) => string;

/**
 * Read a widget source file with an mtime-keyed cache, optionally piping the
 * raw content through a `transform` so the transformed output is cached too.
 *
 * The four widget files total ~140KB and would otherwise be re-read +
 * re-stringified + re-regex'd synchronously on every page load — adding up
 * across HMR cycles and multiple concurrent example servers. The mtime check
 * preserves the "edit a widget file, reload page, see change" dev loop
 * without paying for the read or the transform on subsequent requests.
 *
 * Caches per (transform-identity, path), so the same source file can have
 * multiple cached derivatives (e.g. raw text + JSON-stringified) without
 * collisions. Transforms must be module-level constants — inline arrows
 * would defeat the cache.
 */
export function makeWidgetReader() {
  const cache = new WeakMap<Transform, Map<string, { mtimeMs: number; content: string }>>();
  const IDENTITY: Transform = raw => raw;
  return (path: string, transform: Transform = IDENTITY): string => {
    const mtimeMs = statSync(path).mtimeMs;
    let table = cache.get(transform);
    if (!table) {
      table = new Map();
      cache.set(transform, table);
    }
    const hit = table.get(path);
    if (hit && hit.mtimeMs === mtimeMs) return hit.content;
    const raw = readFileSync(path, 'utf-8');
    const content = transform === IDENTITY ? raw : transform(raw);
    table.set(path, { mtimeMs, content });
    return content;
  };
}

// Module-singleton reader. Plugins call into widget-bootstrap's public API
// (getWidgetScript / buildWidgetBundle / readWidgetAssets) and never see
// the reader directly — the cache is internalized.
export const readWidget = makeWidgetReader();
