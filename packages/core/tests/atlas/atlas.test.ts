import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveAtlasDelta,
  mergeAtlas,
  mergeAtlasFromSteps,
  normalizeNodeId,
  atlasPath,
  type Atlas,
} from '../../src/atlas/atlas.js';
import type { SkillStep } from '../../src/skills/writeSkill.js';

let devRoot: string;
beforeEach(() => {
  devRoot = mkdtempSync(join(tmpdir(), 'hover-atlas-'));
});
afterEach(() => {
  rmSync(devRoot, { recursive: true, force: true });
});

const ORIGIN = 'http://localhost:5174';

/** A representative e-commerce-ish session: navigate → click → type → navigate. */
const session: SkillStep[] = [
  { kind: 'user', text: 'add a product to the cart and check out' },
  { kind: 'step', tool: 'browser_navigate', input: { url: `${ORIGIN}/` } },
  { kind: 'step', tool: 'browser_click', input: { element: 'Add to cart button', ref: 'e12' } },
  { kind: 'step', tool: 'browser_type', input: { element: 'Search input', ref: 'e3', text: 'hunter2-secret' } },
  { kind: 'step', tool: 'browser_navigate', input: { url: `${ORIGIN}/checkout/` } },
  { kind: 'step', tool: 'browser_snapshot', input: {} }, // diagnostic — must not become an edge
  { kind: 'done', summary: 'done' },
];

describe('normalizeNodeId', () => {
  it('same-origin → bare path, trailing slash collapsed, query+hash dropped', () => {
    expect(normalizeNodeId(`${ORIGIN}/checkout/?step=2#pay`, ORIGIN)).toBe('/checkout');
    expect(normalizeNodeId(`${ORIGIN}/`, ORIGIN)).toBe('/');
  });
  it('cross-origin → full origin-prefixed id (popup flows)', () => {
    expect(normalizeNodeId('http://localhost:5177/pay', ORIGIN)).toBe('http://localhost:5177/pay');
  });
  it('unparseable → null', () => {
    expect(normalizeNodeId('not a url', ORIGIN)).toBeNull();
  });
});

describe('deriveAtlasDelta', () => {
  it('derives nodes from navigations and edges from interactions', () => {
    const delta = deriveAtlasDelta(session)!;
    expect(delta.origin).toBe(ORIGIN);
    expect(delta.nodes.map(n => n.id).sort()).toEqual(['/', '/checkout']);
    const kinds = delta.edges.map(e => `${e.kind}:${e.from}→${e.to}`).sort();
    expect(kinds).toEqual([
      'action:/→/',        // click
      'action:/→/',        // type
      'navigate:/→/checkout',
    ]);
  });

  it('never leaks typed values into edge labels (privacy: Q1)', () => {
    const delta = deriveAtlasDelta(session)!;
    const labels = delta.edges.map(e => e.label).join('\n');
    expect(labels).not.toContain('hunter2-secret');
    expect(labels).toContain('Type into Search input');
  });

  it('returns null for a session that never navigated', () => {
    expect(deriveAtlasDelta([{ kind: 'step', tool: 'browser_click', input: { element: 'x' } }])).toBeNull();
  });
});

describe('mergeAtlas', () => {
  it('creates atlas.json on first merge, set-unions on the second', async () => {
    const delta = deriveAtlasDelta(session)!;
    await mergeAtlas(devRoot, delta, 'checkout-flow');
    await mergeAtlas(devRoot, delta, 'checkout-flow-2');
    const atlas = JSON.parse(readFileSync(atlasPath(devRoot), 'utf-8')) as Atlas;
    expect(atlas.version).toBe(1);
    expect(atlas.origin).toBe(ORIGIN);
    // Same delta twice → identical node/edge sets, counts bumped.
    expect(atlas.nodes).toHaveLength(2);
    const nav = atlas.edges.find(e => e.kind === 'navigate')!;
    expect(nav.count).toBe(2);
    expect(nav.specs.sort()).toEqual(['checkout-flow', 'checkout-flow-2']);
  });

  it('quarantines a corrupt atlas.json instead of throwing', async () => {
    mkdirSync(join(devRoot, '.hover'), { recursive: true });
    writeFileSync(atlasPath(devRoot), '{ not json');
    const delta = deriveAtlasDelta(session)!;
    await mergeAtlas(devRoot, delta);
    // Fresh atlas written; corrupt original renamed aside, not deleted.
    const atlas = JSON.parse(readFileSync(atlasPath(devRoot), 'utf-8')) as Atlas;
    expect(atlas.nodes.length).toBeGreaterThan(0);
    const quarantined = readdirSync(join(devRoot, '.hover')).filter(f =>
      f.startsWith('atlas.json.corrupt-'),
    );
    expect(quarantined).toHaveLength(1);
  });
});

describe('mergeAtlasFromSteps', () => {
  it('is a no-op (null) for navigation-free sessions and never throws', async () => {
    expect(await mergeAtlasFromSteps(devRoot, [{ kind: 'user', text: 'hi' }])).toBeNull();
  });
});
