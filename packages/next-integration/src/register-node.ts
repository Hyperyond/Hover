import { ENV_KEYS, readOptionsFromEnv, type HoverOptions } from './options.js';

/**
 * Node.js-runtime implementation of Hover's instrumentation hook.
 *
 * Everything that touches `process.cwd` / `process.once` / Node-only
 * deps (`@hover-dev/core`, `playwright-core`, `ws`) lives here so the
 * Edge-runtime variant of `instrumentation.js` (compiled by Next from
 * the public `register()` entry) never sees these symbols at all. This
 * is what suppresses the "A Node.js API is used (...) which is not
 * supported in the Edge Runtime" warnings that Next emits when it
 * statically analyses imports — Edge bundling stops at the dynamic
 * `await import('./register-node.js')` boundary.
 */
export async function registerNode(overrides: HoverOptions = {}): Promise<void> {
  // Single-process guard: Next dev hot-reloads instrumentation when the
  // file changes, and the user might call register() from multiple places.
  // Reading our own RESOLVED_PORT proves a previous call already booted a
  // service in this process, so we no-op.
  if (process.env[ENV_KEYS.RESOLVED_PORT]) return;

  const fromEnv = readOptionsFromEnv();
  const opts: HoverOptions = { ...fromEnv, ...overrides };

  const enabled = opts.enabled ?? process.env.NODE_ENV === 'development';
  if (!enabled) return;

  const requestedPort = opts.port ?? 51789;
  const chromeDebugPort = opts.chromeDebugPort ?? 9222;
  const autoLaunchChrome = opts.autoLaunchChrome ?? false;
  const agentId = opts.agentId ?? 'claude';
  const model = opts.model ?? 'sonnet';
  const maxBudgetUsd = opts.maxBudgetUsd;

  const { startService } = await import('@hover-dev/core/service');

  let service: Awaited<ReturnType<typeof startService>>;
  try {
    service = await startService({
      port: requestedPort,
      agentId,
      model,
      maxBudgetUsd,
      cdpUrl: `http://localhost:${chromeDebugPort}`,
      devRoot: process.cwd(),
    });
  } catch (err) {
    console.error(
      `[@hover-dev/next] failed to start service: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Publish the resolved port for HoverScript to read at RSC render time.
  process.env[ENV_KEYS.RESOLVED_PORT] = String(service.port);

  const bumped = service.port !== requestedPort;
  console.info(
    `[@hover-dev/next] service ready · ws://127.0.0.1:${service.port}${bumped ? ` (auto-bumped from ${requestedPort})` : ''} · agent=${agentId} model=${model}`,
  );

  // Tear down on process exit. Next manages the dev-server lifecycle and
  // does not expose a public "shutdown" hook to instrumentation, so we
  // hook the Node process directly — same shape as a standalone CLI.
  const shutdown = async (): Promise<void> => {
    try {
      await service.close();
    } catch (err) {
      console.warn(
        `[@hover-dev/next] error closing service: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('beforeExit', shutdown);

  if (!autoLaunchChrome) return;
  const url = opts.devUrl ?? 'http://localhost:3000/';
  const { launchDebugChrome } = await import('@hover-dev/core/launch-chrome');
  launchDebugChrome({ url, port: chromeDebugPort })
    .then(result => {
      if (!result.ok) {
        console.warn(`[@hover-dev/next] couldn't auto-launch Chrome: ${result.reason}`);
      } else if (result.alreadyRunning) {
        console.info(`[@hover-dev/next] reusing existing debug Chrome on :${result.port}`);
      } else {
        console.info(`[@hover-dev/next] debug Chrome launched on :${result.port}`);
      }
    })
    .catch(err => {
      console.warn(
        `[@hover-dev/next] Chrome auto-launch error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
