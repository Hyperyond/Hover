/**
 * Deterministic API-spec crystallizer — the API-layer sibling of writeSpec.
 *
 * Writes a `<devRoot>/__vibe_tests__/<slug>.api-test.spec.ts` from a list of
 * `ApiCheck`s the agent assembled (observed via CDP capture, optionally with a
 * mutation it verified with replay_request). Pure `@playwright/test`
 * `APIRequestContext` — `request.get/post(...)` + status / shape / authz
 * assertions. No LLM in the codegen path: a 1:1 string-template translation, so
 * record == replay holds for the API layer too (the call that was captured is
 * the call that's asserted).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { slugify, firstSentence } from './text.js';
import { specDir, specPath } from './specPaths.js';

/** One asserted API call — a contract, shape, or authz check. */
export interface ApiCheck {
  /** Short imperative title → the `test()` name (e.g. "GET /api/cart returns the cart"). */
  title: string;
  /** HTTP method. */
  method: string;
  /** URL as captured. Same-origin URLs are relativized to a path so the spec
   *  rides the config's baseURL; cross-origin URLs are emitted in full. */
  url: string;
  /** Request body to send (objects are emitted as a JSON literal via `data`). */
  requestBody?: unknown;
  /** Headers to send. For an authz check the agent omits/alters the auth header. */
  headers?: Record<string, string>;
  /** Expected status — observed for a contract check, or expected-after-mutation
   *  for an authz check (verified with replay_request before crystallizing). */
  expectStatus?: number;
  /** Top-level response keys to assert present (a light shape contract). */
  expectBodyKeys?: string[];
  /** Optional human note → emitted as a leading comment (e.g. "authz: no session → 401"). */
  note?: string;
}

export interface WriteApiSpecOptions {
  devRoot: string;
  name: string;
  description?: string;
  checks: ApiCheck[];
  /** Run target origin — same-origin URLs are relativized against it. */
  startUrl?: string;
  overwrite?: boolean;
}

export interface WriteApiSpecResult {
  path: string;
  slug: string;
}

const KNOWN_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head']);

function q(s: string): string {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Same-origin → path (rides baseURL); cross-origin → full URL. */
function toRequestUrl(url: string, startUrl?: string): string {
  try {
    const u = new URL(url);
    if (startUrl) {
      const base = new URL(startUrl);
      if (u.origin === base.origin) return (u.pathname + u.search) || '/';
    }
    return url;
  } catch {
    return url; // already a path, or unparseable — emit as-is
  }
}

function renderCheck(check: ApiCheck, startUrl?: string): string {
  const m = check.method.toLowerCase();
  const useFetch = !KNOWN_METHODS.has(m);
  const fn = useFetch ? 'fetch' : m;
  const url = toRequestUrl(check.url, startUrl);

  // Build the options object (data / headers / method-for-fetch).
  const opts: string[] = [];
  if (useFetch) opts.push(`method: ${q(check.method.toUpperCase())}`);
  if (check.requestBody !== undefined && m !== 'get' && m !== 'head') {
    opts.push(`data: ${JSON.stringify(check.requestBody)}`);
  }
  if (check.headers && Object.keys(check.headers).length) {
    opts.push(`headers: ${JSON.stringify(check.headers)}`);
  }
  const callArgs = opts.length ? `${q(url)}, { ${opts.join(', ')} }` : q(url);

  const body: string[] = [];
  if (check.note) body.push(`    // ${check.note}`);
  body.push(`    const res = await request.${fn}(${callArgs});`);
  if (typeof check.expectStatus === 'number') {
    body.push(`    expect(res.status()).toBe(${check.expectStatus});`);
  } else {
    body.push(`    expect(res.ok()).toBeTruthy();`);
  }
  if (check.expectBodyKeys && check.expectBodyKeys.length) {
    body.push(`    const body = await res.json();`);
    for (const k of check.expectBodyKeys) {
      body.push(`    expect(body).toHaveProperty(${q(k)});`);
    }
  }

  const title = check.title.replace(/'/g, "\\'");
  return [`  test('${title}', async ({ request }) => {`, ...body, `  });`].join('\n');
}

export async function writeApiSpec(opts: WriteApiSpecOptions): Promise<WriteApiSpecResult> {
  const slug = slugify(opts.name);
  if (!slug) throw new Error('api spec name must contain at least one alphanumeric character');
  if (!opts.checks.length) throw new Error('api spec needs at least one check');

  const dir = specDir(opts.devRoot, 'api');
  const path = specPath(opts.devRoot, 'api', slug);
  if (existsSync(path) && !opts.overwrite) {
    throw new Error(`${path} already exists (pass overwrite to replace)`);
  }

  const header = opts.description ? `// ${firstSentence(opts.description)}` : null;
  const lines = [
    ...(header ? [header] : []),
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test.describe(${q(opts.name)}, () => {`,
    opts.checks.map(c => renderCheck(c, opts.startUrl)).join('\n\n'),
    `});`,
    ``,
  ];

  await mkdir(dir, { recursive: true });
  await writeFile(path, lines.join('\n'), 'utf-8');
  return { path, slug };
}
