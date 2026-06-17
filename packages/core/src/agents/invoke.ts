// cross-spawn is a drop-in for child_process.spawn that fixes Windows behaviour
// around `.cmd`/`.bat` shims (e.g. npm-installed `claude.cmd`). The return type
// is identical to node:child_process so call sites are unchanged.
import spawn from 'cross-spawn';
import { createInterface } from 'node:readline';
import { buildArgv } from './argv.js';
import { resolveBinForAgent } from './detect.js';
import { getAgent } from './registry.js';
import {
  AgentNotInstalledError,
  UnsupportedAgentProtocolError,
} from './types.js';
import type { InvokeEvent, InvokeOptions, ParserState } from './types.js';

/**
 * Spawn an agent and yield normalized InvokeEvents as they arrive.
 *
 * Lifecycle: the generator owns the child process. Iterating to completion
 * drains stdout; breaking early (e.g. WS disconnect) runs the finally block
 * which closes readline and SIGTERMs the child, so we never leak orphan
 * agent processes that would keep driving the browser (and burning tokens)
 * after the user has navigated away.
 */
export async function* invokeAgent(opts: InvokeOptions): AsyncIterable<InvokeEvent> {
  const descriptor = getAgent(opts.agentId);
  if (!descriptor) {
    throw new UnsupportedAgentProtocolError(`Unknown agent: ${opts.agentId}`);
  }

  const bin = await resolveBinForAgent(descriptor);
  if (!bin) throw new AgentNotInstalledError(opts.agentId);

  const argv = buildArgv(descriptor, opts);
  const usesStdinPrompt = descriptor.protocol === 'stdin';

  const child = spawn(bin, argv, {
    stdio: [usesStdinPrompt ? 'pipe' : 'ignore', 'pipe', 'inherit'],
    cwd: opts.cwd,
    // Clear CLAUDECODE so spawning `claude` from inside a Claude Code session
    // doesn't trip the nested-session guard. Harmless for other agents.
    // The CLI authenticates via its own logged-in subscription (or inherits any
    // key already in process.env); opts.env carries the Local LLM endpoint vars.
    env: {
      ...process.env,
      CLAUDECODE: '',
      ...(opts.env ?? {}),
    },
  });

  const onAbort = () => {
    if (!child.killed) child.kill('SIGTERM');
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  if (usesStdinPrompt && child.stdin) {
    child.stdin.write(opts.prompt);
    child.stdin.end();
  }

  const rl = createInterface({ input: child.stdout! });
  const exitPromise = new Promise<number>(res => child.on('exit', c => res(c ?? -1)));

  const state: ParserState = {};
  let sawSessionEnd = false;

  try {
    for await (const line of rl) {
      for (const ev of descriptor.parseEvent(line, state)) {
        if (ev.kind === 'session_end') sawSessionEnd = true;
        yield ev;
      }
    }

    const code = await exitPromise;

    if (!sawSessionEnd && !opts.signal?.aborted) {
      // Give the descriptor a chance to synthesize its own terminator from
      // accumulated state (codex does this — its stream never emits a
      // session_end). Falls back to a generic error session_end if the
      // descriptor declines and the child exited non-zero.
      const synthetic = descriptor.onStreamEnd?.(code, state);
      if (synthetic) {
        yield synthetic;
      } else if (code !== 0) {
        yield {
          kind: 'session_end',
          isError: true,
          summary: `agent exited with code ${code}`,
        };
      }
    }
  } finally {
    rl.close();
    if (!child.killed) child.kill('SIGTERM');
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
