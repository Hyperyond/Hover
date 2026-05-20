import type { AgentDescriptor, InvokeOptions } from './types.js';
import { UnsupportedAgentProtocolError } from './types.js';

/**
 * Build argv for spawning an agent.
 *
 * Per-agent argument logic lives on the descriptor (e.g. claude.ts owns its
 * own `--mcp-config`, `--permission-mode` etc.). This dispatcher only
 * gates by protocol — `acp` and `pi-rpc` are not yet implemented because
 * they require a long-lived bidirectional channel rather than argv.
 */
export function buildArgv(descriptor: AgentDescriptor, opts: InvokeOptions): string[] {
  switch (descriptor.protocol) {
    case 'argv':
    case 'stdin':
      return descriptor.buildArgs(opts);
    case 'acp':
    case 'pi-rpc':
      throw new UnsupportedAgentProtocolError(
        `Agent protocol "${descriptor.protocol}" is not yet implemented (agent: ${descriptor.id})`,
      );
    default: {
      const exhaustive: never = descriptor.protocol;
      throw new UnsupportedAgentProtocolError(`Unknown protocol: ${String(exhaustive)}`);
    }
  }
}
