import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { useSuiteSession, type SuiteEngine } from '../src/useSuiteSession.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

function Harness({
  engine,
  autoConfirm,
  autoAnswer,
}: {
  engine: SuiteEngine;
  autoConfirm?: boolean;
  autoAnswer?: string;
}) {
  const s = useSuiteSession({ engine });
  useEffect(() => {
    s.start('explore');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (autoConfirm && s.state.phase === 'proposing') s.confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.state.phase]);
  useEffect(() => {
    if (autoAnswer != null && s.pendingAsk) s.answerAsk(autoAnswer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.pendingAsk]);
  return (
    <Box flexDirection="column">
      <Text>phase:{s.state.phase}</Text>
      {s.state.items.map((it) => (
        <Text key={it.id}>
          item:{it.name}:{it.status}:{it.note ?? ''}
        </Text>
      ))}
      {s.lines.map((l) => (
        <Text key={l.id}>
          line:{l.kind}:{l.text}
        </Text>
      ))}
    </Box>
  );
}

describe('useSuiteSession', () => {
  it('explore collects candidates → proposing; confirm crystallizes each', async () => {
    const crystallize = vi.fn(async (c: { id: string }) => ({ path: `/p/__vibe_tests__/${c.id}.spec.ts` }));
    const engine: SuiteEngine = {
      async explore({ onCandidate, onFact }) {
        onCandidate({ name: 'Log in', steps: [{ kind: 'step', tool: 't' }] });
        onCandidate({ name: 'Add to cart', steps: [] });
        onFact({ title: 'guests cannot checkout', rule: 'must log in' });
        return { isError: false };
      },
      crystallize: crystallize as unknown as SuiteEngine['crystallize'],
    };

    const { lastFrame } = render(<Harness engine={engine} autoConfirm />);
    await tick();
    const f = lastFrame() ?? '';

    expect(f).toContain('phase:done');
    expect(f).toContain('item:Log in:pass:log-in.spec.ts');
    expect(f).toContain('item:Add to cart:pass:add-to-cart.spec.ts');
    expect(f).toContain('line:info:remembered: guests cannot checkout');
    expect(crystallize).toHaveBeenCalledTimes(2);
  });

  it('self-verifies each generated spec: pass marks verified, fail marks failed', async () => {
    const engine: SuiteEngine = {
      async explore({ onCandidate }) {
        onCandidate({ name: 'Log in', steps: [] });
        onCandidate({ name: 'Checkout', steps: [] });
        return { isError: false };
      },
      async crystallize(c) {
        return { path: `/p/__vibe_tests__/${c.id}.spec.ts` };
      },
      async verify(c) {
        // Checkout fails replay; Log in passes.
        return c.id === 'checkout' ? { ok: false, failures: [{ tool: 'click_control', error: 'button "Pay" not visible' }] } : { ok: true };
      },
    };

    const { lastFrame } = render(<Harness engine={engine} autoConfirm />);
    await tick(80);
    const f = lastFrame() ?? '';

    expect(f).toContain('item:Log in:pass:verified');
    expect(f).toContain('item:Checkout:fail:button "Pay" not visible');
    expect(f).toContain('line:info:✓ Log in replays');
    expect(f).toContain('line:error:✗ Checkout failed replay: button "Pay" not visible');
  });

  it('routes ask_user to the UI and returns the answer to the agent', async () => {
    let answered: string | undefined;
    const engine: SuiteEngine = {
      async explore({ onAsk }) {
        const a = await onAsk({ askId: 'q1', question: 'Which account?', options: [{ label: 'alice' }], allowFreeText: true });
        answered = a.value;
        return { isError: false };
      },
      async crystallize() {
        return { path: 'x' };
      },
    };

    render(<Harness engine={engine} autoAnswer="alice" />);
    await tick();
    expect(answered).toBe('alice');
  });

  it('an explore failure surfaces as an error line and ends', async () => {
    const engine: SuiteEngine = {
      async explore() {
        throw new Error('No coding-agent CLI found on PATH.');
      },
      async crystallize() {
        return { path: 'x' };
      },
    };
    const { lastFrame } = render(<Harness engine={engine} />);
    await tick();
    const f = lastFrame() ?? '';
    expect(f).toContain('line:error:No coding-agent CLI found on PATH.');
    expect(f).toContain('phase:done');
  });
});
