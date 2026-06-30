import { replayGroundedSteps, type QaIntensity } from '@hover-dev/core/engine';
import type { Backchannel } from './backchannel.js';
import type { ExploreArgs, SuiteEngine } from '../useSuiteSession.js';
import type { SuiteCandidate } from '../suiteModel.js';
import { driveExplore } from './driver.js';
import { crystallizeCandidate } from './crystallize.js';

/* The real {@link SuiteEngine}: binds the run context + the control back-channel.
 * `explore` points the back-channel's handlers at this run, then drives the
 * autonomous exploration with the back-channel's port as the approval channel.
 * `crystallize` writes one chosen candidate to a Playwright spec. */

export interface SuiteEngineCtx {
  target: string;
  devRoot: string;
  agentId?: string;
  model?: string;
  intensity: QaIntensity;
  cdpPort?: number;
}

export function makeSuiteEngine(ctx: SuiteEngineCtx, bc: Backchannel): SuiteEngine {
  return {
    async explore(args: ExploreArgs) {
      bc.setHandlers({
        onCandidate: args.onCandidate,
        onFact: args.onFact,
        onAsk: args.onAsk,
      });
      try {
        const res = await driveExplore({
          goal: args.goal,
          target: ctx.target,
          devRoot: ctx.devRoot,
          agentId: ctx.agentId,
          model: ctx.model,
          intensity: ctx.intensity,
          cdpPort: ctx.cdpPort,
          approvalPort: bc.port,
          onEvent: args.onEvent,
          signal: args.signal,
        });
        return { isError: res.isError };
      } finally {
        bc.setHandlers({});
      }
    },

    async crystallize(candidate: SuiteCandidate) {
      const res = await crystallizeCandidate({
        devRoot: ctx.devRoot,
        target: ctx.target,
        candidate: { name: candidate.name, description: candidate.description, steps: candidate.steps },
      });
      return { path: res.path };
    },

    async verify(candidate: SuiteCandidate) {
      const res = await replayGroundedSteps({
        cdpUrl: `http://localhost:${ctx.cdpPort ?? 9222}`,
        devUrl: ctx.target,
        steps: candidate.steps,
      });
      return { ok: res.ok, failures: res.failures.map((f) => ({ tool: f.tool, error: f.error })) };
    },
  };
}
