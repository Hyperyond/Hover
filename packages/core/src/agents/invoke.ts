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
import type { InvokeEvent, InvokeOptions } from './types.js';

/**
 * Spawn an agent and yield normalized InvokeEvents as they arrive.
 *
 * Caller is responsible for the lifecycle of `AsyncIterable`: iterating
 * to completion drains stdout; aborting via `break` will leave the child
 * running (use AbortController in a future iteration if needed).
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
    env: { ...process.env, CLAUDECODE: '' },
  });

  // Wire abort: when the caller signals (e.g. WS disconnect), terminate the
  // child so we don't leak orphan agent processes that keep driving the
  // browser after the user has navigated away.
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

  let sawSessionEnd = false;
  for await (const line of rl) {
    for (const ev of descriptor.parseEvent(line)) {
      if (ev.kind === 'session_end') sawSessionEnd = true;
      yield ev;
    }
  }

  const code = await exitPromise;
  opts.signal?.removeEventListener('abort', onAbort);
  if (!sawSessionEnd && code !== 0 && !opts.signal?.aborted) {
    yield {
      kind: 'session_end',
      isError: true,
      summary: `agent exited with code ${code}`,
    };
  }
}
