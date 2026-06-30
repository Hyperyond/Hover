import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { startBackchannel, type Backchannel, type Candidate, type Fact } from '../src/engine/backchannel.js';

let bc: Backchannel | undefined;
afterEach(async () => {
  await bc?.close();
  bc = undefined;
});

/** Connect a ws client mimicking the control MCP server. */
function connect(port: number): Promise<WebSocket> {
  const sock = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise((res, rej) => {
    sock.once('open', () => res(sock));
    sock.once('error', rej);
  });
}
const send = (sock: WebSocket, type: string, payload: unknown) => sock.send(JSON.stringify({ type, payload }));
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('startBackchannel', () => {
  it('routes record-candidate / record-fact to handlers', async () => {
    const candidates: Candidate[] = [];
    const facts: Fact[] = [];
    bc = await startBackchannel({
      onCandidate: (c) => candidates.push(c),
      onFact: (f) => facts.push(f),
    });
    const sock = await connect(bc.port);

    send(sock, 'record-candidate', { candidate: { name: 'Log in', description: 'auth', steps: [{ kind: 'step', tool: 'x' }] } });
    send(sock, 'record-fact', { fact: { title: 'guests cannot checkout', rule: 'must log in first' } });
    await tick();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ name: 'Log in', description: 'auth' });
    expect(candidates[0].steps).toHaveLength(1);
    expect(facts[0]).toMatchObject({ title: 'guests cannot checkout' });
    sock.close();
  });

  it('round-trips an ask-user-request → ask-user-response by askId', async () => {
    bc = await startBackchannel({
      onAsk: async (req) => {
        expect(req.question).toBe('Which account?');
        expect(req.options.map((o) => o.label)).toEqual(['alice', 'bob']);
        return { value: 'alice' };
      },
    });
    const sock = await connect(bc.port);

    const reply = new Promise<{ askId: string; value?: string }>((res) => {
      sock.on('message', (d: Buffer) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'ask-user-response') res(m.payload);
      });
    });
    send(sock, 'ask-user-request', {
      askId: 'q1',
      question: 'Which account?',
      options: [{ label: 'alice' }, { label: 'bob' }],
      allowFreeText: false,
    });

    const payload = await reply;
    expect(payload.askId).toBe('q1');
    expect(payload.value).toBe('alice');
    sock.close();
  });

  it('answers cancelled when no onAsk handler is set', async () => {
    bc = await startBackchannel({});
    const sock = await connect(bc.port);
    const reply = new Promise<{ cancelled?: boolean }>((res) => {
      sock.on('message', (d: Buffer) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'ask-user-response') res(m.payload);
      });
    });
    send(sock, 'ask-user-request', { askId: 'q2', question: 'hi', options: [], allowFreeText: true });
    expect((await reply).cancelled).toBe(true);
    sock.close();
  });

  it('ignores malformed messages without crashing', async () => {
    let got = 0;
    bc = await startBackchannel({ onFact: () => (got += 1) });
    const sock = await connect(bc.port);
    sock.send('not json');
    send(sock, 'record-fact', { fact: { title: 't', rule: 'r' } });
    await tick();
    expect(got).toBe(1);
    sock.close();
  });
});
