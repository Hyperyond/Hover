import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import type { InvokeEvent } from '@hover-dev/core';
import { useSession } from '../src/useSession.js';
import type { Runner } from '../src/engine/driver.js';

const tick = () => new Promise((r) => setTimeout(r, 20));

/** A fake runner that streams a canned event sequence — no Chrome, no agent. */
const fakeRunner: Runner = async (_goal, onEvent) => {
  onEvent({ kind: 'session_start', sessionId: 'abcdef12', model: 'sonnet' } as InvokeEvent);
  onEvent({ kind: 'text', text: 'Exploring the app.' } as InvokeEvent);
  onEvent({ kind: 'tool_use', tool: 'mcp__hovercontrol__click_control', input: { name: 'Sign in' } } as InvokeEvent);
  onEvent({ kind: 'session_end', isError: false, summary: 'done' } as InvokeEvent);
  return { steps: [], summary: 'done', isError: false };
};

function Harness({ runner, goal }: { runner?: Runner; goal: string }) {
  const session = useSession({ runner });
  useEffect(() => {
    session.start(goal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Box flexDirection="column">
      <Text>phase:{session.phase}</Text>
      {session.lines.map((l) => (
        <Text key={l.id}>
          {l.kind}:{l.text}
        </Text>
      ))}
    </Box>
  );
}

describe('useSession', () => {
  it('streams a runner: user line + mapped events, ends in done', async () => {
    const { lastFrame } = render(<Harness runner={fakeRunner} goal="test the login flow" />);
    await tick();
    const f = lastFrame() ?? '';
    expect(f).toContain('user:test the login flow');
    expect(f).toContain('narration:Exploring the app.');
    expect(f).toContain('tool:click "Sign in"');
    expect(f).toContain('phase:done');
  });

  it('with no runner, echoes a hint instead of crashing', async () => {
    const { lastFrame } = render(<Harness goal="do something" />);
    await tick();
    const f = lastFrame() ?? '';
    expect(f).toContain('user:do something');
    expect(f).toContain('no engine wired');
  });

  it('surfaces a runner failure as an error line', async () => {
    const boom: Runner = async () => {
      throw new Error('No coding-agent CLI found on PATH.');
    };
    const { lastFrame } = render(<Harness runner={boom} goal="go" />);
    await tick();
    const f = lastFrame() ?? '';
    expect(f).toContain('error:No coding-agent CLI found on PATH.');
  });
});
