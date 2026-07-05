import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareGuard } from '../../src/specs/declareGuard.js';
import { parseBusinessMap } from '../../src/specs/businessMap.js';

let root: string;
const mapPath = () => join(root, '.hover', 'hover-map.md');
const readMap = () => readFileSync(mapPath(), 'utf-8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hover-guard-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('declareGuard', () => {
  it('creates the map with a pending line + acceptance note when nothing exists', async () => {
    const r = await declareGuard(root, {
      area: 'Practice',
      line: 'Daily check-in',
      route: '/checkin',
      criteria: ['clicking 打卡 shows 已打卡', '7-day streak shows a badge on /stats'],
    });
    expect('path' in r && r.created).toBe(true);
    const src = readMap();
    expect(src).toContain('## Practice');
    expect(src).toContain('- [ ] Daily check-in — /checkin');
    expect(src).toContain('Note: acceptance = clicking 打卡 shows 已打卡; 7-day streak shows a badge on /stats');
  });

  it('round-trips through the canonical parser as an uncovered line', async () => {
    await declareGuard(root, { area: 'Practice', line: 'Daily check-in', route: '/checkin', criteria: ['a'] });
    const graph = parseBusinessMap(readMap());
    const line = graph.nodes.find((n) => n.kind === 'line' && n.label === 'Daily check-in');
    expect(line).toBeTruthy();
    expect(line?.status).toBe('uncovered');
    expect(line?.route).toBe('/checkin');
    expect(graph.nodes.some((n) => n.kind === 'area' && n.label === 'Practice')).toBe(true);
    expect(graph.stats.lines).toBe(1);
    expect(graph.stats.covered).toBe(0);
  });

  it('appends into an existing area and before the Relationships tail', async () => {
    mkdirSync(join(root, '.hover'), { recursive: true });
    writeFileSync(
      mapPath(),
      '# Business map — app\n## Practice\n- [x] Reveal word — / — reveal.spec.ts\n\n## Relationships\n- Reveal word depends-on Log in\n',
    );
    await declareGuard(root, { area: 'Practice', line: 'Daily check-in', criteria: ['c1'] });
    const src = readMap();
    // new line lives inside Practice, not after Relationships
    expect(src.indexOf('- [ ] Daily check-in')).toBeLessThan(src.indexOf('## Relationships'));
    // and a NEW area also lands before the tail
    await declareGuard(root, { area: 'Rewards', line: 'Badge wall', criteria: ['c2'] });
    const src2 = readMap();
    expect(src2.indexOf('## Rewards')).toBeLessThan(src2.indexOf('## Relationships'));
  });

  it('re-declaring updates the note in place without duplicating the line', async () => {
    await declareGuard(root, { area: 'Practice', line: 'Daily check-in', criteria: ['old'] });
    await declareGuard(root, { area: 'Practice', line: 'Daily check-in', criteria: ['new', 'newer'] });
    const src = readMap();
    expect(src.match(/Daily check-in/g)?.length).toBe(1);
    expect(src).toContain('acceptance = new; newer');
    expect(src).not.toContain('acceptance = old');
  });

  it('never flips an existing [x] line back to pending', async () => {
    mkdirSync(join(root, '.hover'), { recursive: true });
    writeFileSync(mapPath(), '# Business map — app\n## Practice\n- [x] Daily check-in — /checkin — daily.spec.ts\n');
    await declareGuard(root, { area: 'Practice', line: 'Daily check-in', criteria: ['refined'] });
    const src = readMap();
    expect(src).toContain('- [x] Daily check-in');
    expect(src).toContain('acceptance = refined');
  });
});
