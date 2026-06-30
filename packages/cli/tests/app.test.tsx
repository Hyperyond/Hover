import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { App, type SessionMeta, type StreamLine } from '../src/app.js';
import type { SuiteState } from '../src/suiteModel.js';

const meta: SessionMeta = { agent: 'claude', model: 'sonnet', target: 'localhost:5173' };
const lines: StreamLine[] = [
  { id: 1, kind: 'narration', text: 'Exploring the app to learn its business lines…' },
  { id: 2, kind: 'tool', text: 'click "Sign in"' },
  { id: 3, kind: 'info', text: 'remembered: guests cannot checkout' },
];
const proposing: SuiteState = {
  phase: 'proposing',
  items: [
    { id: 'log-in', name: 'Log in', steps: [], status: 'queued', selected: true },
    { id: 'add-to-cart', name: 'Add to cart', steps: [], status: 'queued', selected: true },
    { id: 'search', name: 'Search products', steps: [], status: 'queued', selected: false },
  ],
};

describe('App (autonomous suite UI)', () => {
  it('renders the pick phase: header, run stream, and the PICK FLOWS panel', () => {
    const { lastFrame } = render(<App meta={meta} initialState={proposing} initialLines={lines} />);
    const f = lastFrame() ?? '';
    // eslint-disable-next-line no-console
    console.log('\n' + f + '\n');

    expect(f).toContain('Hover');
    expect(f).toContain('pick flows to keep');
    expect(f).toContain('claude · sonnet · localhost:5173');
    expect(f).toContain('PICK FLOWS · 2/3');
    expect(f).toContain('[x] Log in');
    expect(f).toContain('[ ] Search products');
    expect(f).toContain('Exploring the app');
    expect(f).toContain('enter generate 2 flows');
  });

  it('shows the empty state with no engine wired', () => {
    const { lastFrame } = render(<App meta={meta} />);
    const f = lastFrame() ?? '';
    expect(f).toContain('No flows yet.');
    expect(f).toContain('Press enter to explore');
    expect(f).toContain('enter to explore · ctrl+c to quit');
  });
});
