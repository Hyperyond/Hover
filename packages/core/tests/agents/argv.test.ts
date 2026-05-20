import { describe, it, expect } from 'vitest';
import { buildArgv } from '../../src/agents/argv.js';
import { UnsupportedAgentProtocolError } from '../../src/agents/types.js';
import type { AgentDescriptor, InvokeOptions } from '../../src/agents/types.js';

const baseOpts: InvokeOptions = { agentId: 'fake', prompt: 'hi' };

function fakeDescriptor(overrides: Partial<AgentDescriptor> = {}): AgentDescriptor {
  return {
    id: 'fake',
    binName: 'fake',
    protocol: 'argv',
    streamFormat: 'stream-json',
    buildArgs: (opts) => ['--prompt', opts.prompt],
    parseEvent: () => [],
    ...overrides,
  };
}

describe('buildArgv', () => {
  it('delegates to descriptor.buildArgs for argv protocol', () => {
    const argv = buildArgv(fakeDescriptor({ protocol: 'argv' }), baseOpts);
    expect(argv).toEqual(['--prompt', 'hi']);
  });

  it('delegates to descriptor.buildArgs for stdin protocol', () => {
    const argv = buildArgv(fakeDescriptor({ protocol: 'stdin' }), baseOpts);
    expect(argv).toEqual(['--prompt', 'hi']);
  });

  it('throws UnsupportedAgentProtocolError for acp protocol', () => {
    expect(() => buildArgv(fakeDescriptor({ protocol: 'acp' }), baseOpts)).toThrow(
      UnsupportedAgentProtocolError,
    );
  });

  it('throws UnsupportedAgentProtocolError for pi-rpc protocol', () => {
    expect(() => buildArgv(fakeDescriptor({ protocol: 'pi-rpc' }), baseOpts)).toThrow(
      UnsupportedAgentProtocolError,
    );
  });
});
