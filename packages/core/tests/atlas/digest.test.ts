import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAtlasDigest } from '../../src/atlas/digest.js';
import { mergeAtlas, deriveAtlasDelta, atlasPath } from '../../src/atlas/atlas.js';
import type { SkillStep } from '../../src/skills/writeSkill.js';

let devRoot: string;
beforeEach(() => {
  devRoot = mkdtempSync(join(tmpdir(), 'hover-digest-'));
});
afterEach(() => {
  rmSync(devRoot, { recursive: true, force: true });
});

const ORIGIN = 'http://localhost:5174';
const session: SkillStep[] = [
  { kind: 'step', tool: 'browser_navigate', input: { url: `${ORIGIN}/` } },
  { kind: 'step', tool: 'browser_click', input: { element: 'Add to cart button' } },
  { kind: 'step', tool: 'browser_navigate', input: { url: `${ORIGIN}/checkout` } },
];

describe('buildAtlasDigest', () => {
  it('returns null when no atlas exists (and never throws)', async () => {
    expect(await buildAtlasDigest(devRoot)).toBeNull();
  });

  it('returns null for a corrupt atlas', async () => {
    mkdirSync(join(devRoot, '.hover'), { recursive: true });
    writeFileSync(atlasPath(devRoot), 'nope');
    expect(await buildAtlasDigest(devRoot)).toBeNull();
  });

  it('renders routes + verified paths with the staleness caveat', async () => {
    await mergeAtlas(devRoot, deriveAtlasDelta(session)!, 'checkout');
    const digest = (await buildAtlasDigest(devRoot))!;
    expect(digest).toContain('Routes seen: /, /checkout');
    expect(digest).toContain('/ → /checkout');
    expect(digest).toContain('Click Add to cart button');
    expect(digest).toContain('may be stale');
  });

  it('stays under the size cap on a large atlas', async () => {
    // 200 distinct routes — far past the edge cap.
    const big: SkillStep[] = Array.from({ length: 200 }, (_, i) => ({
      kind: 'step' as const,
      tool: 'browser_navigate',
      input: { url: `${ORIGIN}/page-${i}` },
    }));
    await mergeAtlas(devRoot, deriveAtlasDelta(big)!);
    const digest = (await buildAtlasDigest(devRoot))!;
    expect(digest.length).toBeLessThanOrEqual(2000);
  });
});
