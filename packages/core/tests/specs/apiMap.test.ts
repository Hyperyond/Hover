import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordApiOnMap, endpointLabel } from '../../src/specs/apiMap.js';
import { parseBusinessMap } from '../../src/specs/businessMap.js';

let root: string;
const mapPath = () => join(root, '.hover', 'hover-map.md');
const readMap = () => readFileSync(mapPath(), 'utf-8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hover-apimap-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('endpointLabel', () => {
  it('reduces absolute URLs to METHOD /path and passes paths through', () => {
    expect(endpointLabel('post', 'https://app.dev/api/orders?x=1')).toBe('POST /api/orders');
    expect(endpointLabel('GET', '/api/cart')).toBe('GET /api/cart');
  });
});

describe('recordApiOnMap', () => {
  it('creates the ## API area with a covered line that existing parsers read', async () => {
    const r = await recordApiOnMap(root, {
      name: 'orders',
      endpoints: ['POST /api/orders', 'GET /api/cart'],
      specFile: '/repo/__vibe_tests__/orders.api-test.spec.ts',
    });
    expect('path' in r && r.created).toBe(true);
    const md = readMap();
    expect(md).toContain('## API');
    expect(md).toContain('- [x] orders — POST /api/orders · GET /api/cart — orders.api-test.spec.ts');
    // Zero-new-syntax invariant: the stock parser sees a covered line + spec.
    const g = parseBusinessMap(md);
    const line = g.nodes.find((n) => n.kind === 'line' && n.label === 'orders');
    expect(line?.status).toBe('covered');
    expect(g.nodes.some((n) => n.kind === 'spec' && n.label === 'orders.api-test.spec.ts')).toBe(true);
  });

  it('inserts before the Relationships tail and upserts by spec filename', async () => {
    mkdirSync(join(root, '.hover'), { recursive: true });
    writeFileSync(
      mapPath(),
      ['# Business map — shop', '## Checkout', '- [x] Place order — /checkout — checkout.spec.ts', '## Relationships', '- Place order depends-on Log in', ''].join('\n'),
    );
    await recordApiOnMap(root, { name: 'orders', endpoints: ['POST /api/orders'], specFile: 'orders.api-test.spec.ts' });
    let md = readMap();
    expect(md.indexOf('## API')).toBeLessThan(md.indexOf('## Relationships'));

    // Re-crystallize with more endpoints → same line replaced, not duplicated.
    await recordApiOnMap(root, { name: 'orders', endpoints: ['POST /api/orders', 'DELETE /api/orders/1'], specFile: 'orders.api-test.spec.ts' });
    md = readMap();
    expect(md.match(/orders\.api-test\.spec\.ts/g)?.length).toBe(1);
    expect(md).toContain('DELETE /api/orders/1');
  });

  it('caps a long endpoint list with +N more', async () => {
    const endpoints = Array.from({ length: 9 }, (_, i) => `GET /api/r${i}`);
    await recordApiOnMap(root, { name: 'wide', endpoints, specFile: 'wide.api-test.spec.ts' });
    expect(readMap()).toContain('· +3 more — wide.api-test.spec.ts');
  });
});
