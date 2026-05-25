import { describe, it, expect } from 'vitest';
import { transformSourceAttribution } from '../src/source-attribution.js';

const root = '/repo';
const filename = '/repo/src/App.tsx';

function run(code: string) {
  return transformSourceAttribution({ code, filename, root });
}

describe('transformSourceAttribution', () => {
  it('stamps host elements with relative path + line + column', () => {
    const out = run(`export default function App() {
  return <button onClick={() => {}}>hi</button>;
}`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<button data-hover-source="src\/App\.tsx:2:11" onClick/);
  });

  it('does not stamp component elements (PascalCase)', () => {
    const out = run(`export default function App() {
  return <Button onClick={() => {}}>hi</Button>;
}`);
    expect(out).toBeNull();
  });

  it('stamps host elements but skips component siblings', () => {
    const out = run(`export default function App() {
  return (
    <div>
      <Button>nope</Button>
      <span>yes</span>
    </div>
  );
}`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<div data-hover-source/);
    expect(out!.code).toMatch(/<span data-hover-source/);
    expect(out!.code).not.toMatch(/<Button data-hover-source/);
  });

  it('does not overwrite existing data-hover-source', () => {
    const out = run(`export default function App() {
  return <button data-hover-source="manual">hi</button>;
}`);
    expect(out).toBeNull();
  });

  it('handles TypeScript generics in JSX correctly', () => {
    const out = run(`function App() {
  const x = identity<string>("a");
  return <div>{x}</div>;
}`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<div data-hover-source/);
  });

  it('returns null when file contains no JSX-looking content', () => {
    const out = run(`export const x = 1;`);
    expect(out).toBeNull();
  });

  it('returns null on a syntax error rather than throwing', () => {
    const out = run(`export default function App() { return <button`);
    expect(out).toBeNull();
  });

  it('uses forward slashes in relative path on all platforms', () => {
    const out = transformSourceAttribution({
      code: `function A() { return <div />; }`,
      filename: '/repo/src/components/Card.tsx',
      root: '/repo',
    });
    expect(out!.code).toContain('data-hover-source="src/components/Card.tsx:');
  });

  it('preserves existing attributes and inserts ours adjacent to tag name', () => {
    const out = run(`function A() {
  return <input type="text" value="x" />;
}`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<input data-hover-source="[^"]+" type="text" value="x" \/>/);
  });

  it('emits a sourcemap when changes are made', () => {
    const out = run(`function A() { return <div />; }`);
    expect(out).not.toBeNull();
    expect(out!.map).toBeDefined();
    expect(typeof out!.map.toString).toBe('function');
  });

  it('handles fragments without stamping them', () => {
    const out = run(`function A() {
  return <><span>a</span><span>b</span></>;
}`);
    expect(out).not.toBeNull();
    const matches = out!.code.match(/data-hover-source/g) ?? [];
    expect(matches).toHaveLength(2);
  });
});
