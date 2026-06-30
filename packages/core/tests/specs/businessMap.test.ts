import { describe, it, expect } from 'vitest';
import { parseBusinessMap } from '../../src/specs/businessMap.js';

const MAP = `# Business map — basic-app

## Auth
- [x] Log in — /login — log-in.spec.ts

## Counter
- [ ] Increment the counter — /

## Todos
- [x] Add a todo — / — add-a-todo.spec.ts
- [ ] Remove a todo — /
`;

describe('parseBusinessMap', () => {
  it('extracts the app name from the title', () => {
    expect(parseBusinessMap(MAP).app).toBe('basic-app');
    expect(parseBusinessMap('# My Cool App').app).toBe('My Cool App');
    expect(parseBusinessMap('no title').app).toBe('app');
  });

  it('builds app → area → line → spec nodes + edges', () => {
    const g = parseBusinessMap(MAP);
    const byKind = (k: string) => g.nodes.filter((n) => n.kind === k).map((n) => n.label);
    expect(byKind('app')).toEqual(['basic-app']);
    expect(byKind('area')).toEqual(['Auth', 'Counter', 'Todos']);
    expect(byKind('line')).toEqual(['Log in', 'Increment the counter', 'Add a todo', 'Remove a todo']);
    expect(byKind('spec')).toEqual(['log-in.spec.ts', 'add-a-todo.spec.ts']);

    // app connects to every area; each covered line connects to its spec.
    expect(g.edges).toContainEqual({ source: 'app', target: 'area:auth' });
    expect(g.edges).toContainEqual({ source: 'line:auth/log-in', target: 'spec:log-in.spec.ts' });
  });

  it('reads coverage status, route, and spec off each line', () => {
    const g = parseBusinessMap(MAP);
    const login = g.nodes.find((n) => n.id === 'line:auth/log-in')!;
    expect(login).toMatchObject({ status: 'covered', route: '/login', spec: 'log-in.spec.ts' });
    const remove = g.nodes.find((n) => n.label === 'Remove a todo')!;
    expect(remove).toMatchObject({ status: 'uncovered', route: '/' });
    expect(remove.spec).toBeUndefined();
  });

  it('reports stats', () => {
    expect(parseBusinessMap(MAP).stats).toEqual({ lines: 4, covered: 2, areas: 3 });
  });

  it('is total on malformed / empty input', () => {
    expect(parseBusinessMap('').nodes).toEqual([{ id: 'app', label: 'app', kind: 'app' }]);
    expect(() => parseBusinessMap('## A\n- [ ] junk with no dashes\n- not an item')).not.toThrow();
  });
});
