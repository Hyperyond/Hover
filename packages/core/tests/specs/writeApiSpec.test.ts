import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeApiSpec, type ApiCheck } from '../../src/specs/writeApiSpec.js';

describe('writeApiSpec', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hover-api-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const read = (slug: string) => readFile(join(dir, '__vibe_tests__', 'api', `${slug}.api-test.spec.ts`), 'utf-8');

  it('writes a contract check (status + body keys), relativizing same-origin URLs', async () => {
    const checks: ApiCheck[] = [
      {
        title: 'GET /api/cart returns the cart',
        method: 'GET',
        url: 'https://shop.acme.dev/api/cart',
        expectStatus: 200,
        expectBodyKeys: ['items', 'total'],
      },
    ];
    const res = await writeApiSpec({ devRoot: dir, name: 'cart', checks, startUrl: 'https://shop.acme.dev' });
    expect(res.path).toMatch(/cart\.api-test\.spec\.ts$/);
    const src = await read('cart');
    expect(src).toContain("import { test, expect } from '@playwright/test';");
    expect(src).toContain("await request.get('/api/cart')"); // relativized
    expect(src).toContain('expect(res.status()).toBe(200);');
    expect(src).toContain("expect(body).toHaveProperty('items');");
    expect(src).toContain("expect(body).toHaveProperty('total');");
    expect(src).not.toContain('shop.acme.dev'); // origin stripped
  });

  it('emits an authz check with altered headers + a note, expecting 401', async () => {
    const checks: ApiCheck[] = [
      {
        title: 'GET /api/cart requires auth',
        method: 'GET',
        url: '/api/cart',
        headers: { authorization: '' },
        expectStatus: 401,
        note: 'authz: no session → 401',
      },
    ];
    await writeApiSpec({ devRoot: dir, name: 'cart-authz', checks });
    const src = await read('cart-authz');
    expect(src).toContain('// authz: no session → 401');
    expect(src).toContain('headers:');
    expect(src).toContain('expect(res.status()).toBe(401);');
  });

  it('emits a POST with a JSON data body', async () => {
    const checks: ApiCheck[] = [
      { title: 'POST /api/cart adds an item', method: 'POST', url: '/api/cart', requestBody: { sku: 'A1', qty: 2 }, expectStatus: 201 },
    ];
    await writeApiSpec({ devRoot: dir, name: 'add-item', checks });
    const src = await read('add-item');
    expect(src).toContain('await request.post(');
    expect(src).toContain('data: {"sku":"A1","qty":2}');
    expect(src).toContain('expect(res.status()).toBe(201);');
  });

  it('falls back to request.fetch for non-standard methods', async () => {
    const checks: ApiCheck[] = [
      { title: 'OPTIONS preflight', method: 'OPTIONS', url: '/api/cart' },
    ];
    await writeApiSpec({ devRoot: dir, name: 'preflight', checks });
    const src = await read('preflight');
    expect(src).toContain('await request.fetch(');
    expect(src).toContain("method: 'OPTIONS'");
    expect(src).toContain('expect(res.ok()).toBeTruthy();'); // no expectStatus → ok()
  });

  it('rejects an empty check list and a blank name', async () => {
    await expect(writeApiSpec({ devRoot: dir, name: 'x', checks: [] })).rejects.toThrow();
    await expect(writeApiSpec({ devRoot: dir, name: '!!!', checks: [{ title: 't', method: 'GET', url: '/x' }] })).rejects.toThrow();
  });

  it('refuses to overwrite without the flag', async () => {
    const checks: ApiCheck[] = [{ title: 't', method: 'GET', url: '/x', expectStatus: 200 }];
    await writeApiSpec({ devRoot: dir, name: 'dup', checks });
    await expect(writeApiSpec({ devRoot: dir, name: 'dup', checks })).rejects.toThrow(/already exists/);
    await expect(writeApiSpec({ devRoot: dir, name: 'dup', checks, overwrite: true })).resolves.toBeTruthy();
  });
});
