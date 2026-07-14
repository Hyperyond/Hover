/**
 * Generate a GitHub Actions workflow that runs the crystallized specs on every
 * PR — deterministically, with NO AI in the loop (Hover's core thesis: AI
 * authors the spec once, CI just runs plain `playwright test`).
 *
 * The workflow spins the app up inside CI (the project's dev script) and tests
 * localhost, so it's self-contained — no deployment pipeline required. Test
 * account credentials come from GitHub secrets using the same
 * `HOVER_<LABEL>_USER/PASS` names the Environments view exports, so authoring
 * (the vault) and CI (secrets) line up on one convention.
 *
 * It also writes a JSON report (`hover-results.json`) and uploads it as the
 * `hover-results` artifact — the structured result the Hover extension fetches
 * (via GitHub) to surface CI failures in the editor and offer 🏥 Heal on drifted
 * specs, with the heal running locally. No AI in CI; a red check is a real
 * regression until you heal it.
 *
 * If the repo has a HOVER_INGEST_TOKEN secret, a best-effort step also POSTs
 * the same report to Hover Cloud's /api/ingest, tagged with the environment it
 * ran against (`env=ci` by default; HOVER_ENV repo variable overrides) — that
 * feeds the dashboard trends + the cloud heal queue. No secret → the step
 * self-skips; a cloud hiccup never reds the build.
 *
 * Self-heal mode B1 (this file): on a red PR run, a `Report drifted specs` step
 * runs `.github/hover/drift-report.mjs` (DRIFT_REPORT_SCRIPT, written alongside
 * the workflow) to comment the drifted specs + a paste-ready `/mcp__hover__heal
 * <slug>` per spec on the PR — surfacing the heal task the moment it's red. Still
 * NO AI in CI: the heal itself runs locally. (Mode B2 — an opt-in job that heals
 * in CI with the user's own Claude + opens a PR — is a separate workflow.)
 */
import DRIFT_REPORT_SCRIPT from './assets/drift-report.mjs.txt';

/** The CI drift-dispatch script, written to `.github/hover/drift-report.mjs`. */
export { DRIFT_REPORT_SCRIPT };

export interface CiWorkflowOptions {
  /** pnpm | yarn | bun | npm */
  packageManager: string;
  /** package.json script that starts the dev server (dev / start / serve). */
  devScript: string;
  /** URL the app serves on locally, e.g. http://localhost:5173. */
  appUrl: string;
  /** Account env-var names to wire as GitHub secrets (HOVER_<LABEL>_USER/PASS). */
  secretNames: string[];
  /** Parallel shards. ≥2 → a matrix of shard runners + a merge job (faster on a
   *  big suite). 1 / omitted → a single job (the well-tested default). */
  shards?: number;
  /** A cron for scheduled monitoring runs (e.g. '0 6 * * *'). Omit → PRs only. */
  monitorCron?: string;
}

interface PmConfig {
  setup: string[];
  cache: string;
  install: string;
  exec: string;
}

function pmConfig(pm: string): PmConfig {
  switch (pm) {
    case 'pnpm':
      return { setup: ['      - uses: pnpm/action-setup@v4'], cache: 'pnpm', install: 'pnpm install --frozen-lockfile', exec: 'pnpm exec' };
    case 'yarn':
      return { setup: [], cache: 'yarn', install: 'yarn install --frozen-lockfile', exec: 'yarn' };
    case 'bun':
      return { setup: ['      - uses: oven-sh/setup-bun@v2'], cache: '', install: 'bun install', exec: 'bunx' };
    default:
      return { setup: [], cache: 'npm', install: 'npm ci', exec: 'npx' };
  }
}

export function buildWorkflowYaml(o: CiWorkflowOptions): string {
  const pm = pmConfig(o.packageManager);
  const setupBlock = pm.setup.length ? pm.setup.join('\n') + '\n' : '';
  const cacheLine = pm.cache ? `\n          cache: ${pm.cache}` : '';
  const secretEnv = o.secretNames.length
    ? o.secretNames.map((n) => `          ${n}: \${{ secrets.${n} }}`).join('\n')
    : '          # No test-account secrets yet — add accounts in the Hover Environments view.';
  const shards = Math.max(1, Math.floor(o.shards ?? 1));
  const sharded = shards >= 2;
  const scheduleTrigger = o.monitorCron
    ? `\n  schedule:\n    - cron: '${o.monitorCron}'   # scheduled monitoring run`
    : '';

  // Steps every spec-running runner shares: checkout → deps → boot the app.
  const runnerSetup = `      - uses: actions/checkout@v4
${setupBlock}      - uses: actions/setup-node@v4
        with:
          node-version: 20${cacheLine}
      - run: ${pm.install}
      - run: ${pm.exec} playwright install --with-deps chromium
      - name: Ensure axe-core (only if a11y specs exist)
        run: |
          if [ -d __vibe_tests__/a11y ] && [ -z "$(node -e "try{require.resolve('@axe-core/playwright');process.stdout.write('ok')}catch{}" )" ]; then
            npm i --no-save @axe-core/playwright
          fi
      - name: Start the app
        run: ${o.packageManager} run ${o.devScript} &
      - name: Wait for the app
        run: npx --yes wait-on "$BASE_URL" --timeout 120000`;

  // Self-heal B1 + run summary — runs where hover-results.json exists. On a PR it
  // also comments the drifted specs. The heal itself runs LOCALLY; no AI in CI.
  const reportStep = `      - name: Report results + drift (Hover)
        if: \${{ !cancelled() }}
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          node .github/hover/drift-report.mjs || true
          if [ -f hover-drift.md ] && [ "\${{ github.event_name }}" = "pull_request" ]; then
            gh pr comment "\${{ github.event.pull_request.number }}" --body-file hover-drift.md || true
          fi`;

  // Visual baselines are platform-specific, so the FIRST run of a visual spec
  // writes its baseline in CI's Linux env (via --update-snapshots=missing). Open
  // a PR with those new PNGs so a human confirms the captured look is correct
  // (not a pre-existing bug) before it becomes the source of truth — same
  // human-reviewed shape as auto-heal. Same-repo only (fork PRs can't push).
  const baselinePr = `      - name: Visual baselines → review PR (first run of a visual spec)
        if: \${{ !cancelled() && (github.event.pull_request.head.repo.full_name == github.repository || github.event_name != 'pull_request') }}
        env:
          GH_TOKEN: \${{ github.token }}
          HEAD_BRANCH: \${{ github.head_ref || github.ref_name }}
        run: |
          if [ -z "$(git status --porcelain __vibe_tests__ | grep -- '-snapshots/')" ]; then
            echo "No new visual baselines."; exit 0
          fi
          BRANCH="hover/baselines-\${{ github.run_id }}"
          git config user.name "hover-baselines"
          git config user.email "hover-baselines@users.noreply.github.com"
          git fetch origin "$HEAD_BRANCH" && git checkout -B "$BRANCH" "origin/$HEAD_BRANCH"
          git add "__vibe_tests__"
          git commit -m "test(visual): seed Playwright baselines (review the captured look)" || { echo "nothing to commit"; exit 0; }
          git push origin "$BRANCH"
          gh pr create --base "$HEAD_BRANCH" --head "$BRANCH" \\
            --title "🖼 Hover visual baselines — review before merge" \\
            --body "First run of a visual spec generated these Linux screenshot baselines. Confirm each page looks correct (not a pre-existing bug), then merge — future runs pixel-diff against them." || true`;

  const uploads = `      - name: Upload Hover results
        uses: actions/upload-artifact@v4
        if: \${{ !cancelled() }}
        with:
          name: hover-results
          path: hover-results.json
          retention-days: 14
      - uses: actions/upload-artifact@v4
        if: \${{ !cancelled() }}
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
      # The failure media (screenshots + video) Hover Cloud shows in the run
      # record. Playwright writes these under test-results/ on failure; Cloud
      # proxies them on demand and stores no bytes itself. Empty on all-green
      # runs (if-no-files-found: ignore keeps the step from erroring).
      - uses: actions/upload-artifact@v4
        if: \${{ !cancelled() }}
        with:
          name: hover-test-results
          path: test-results/
          if-no-files-found: ignore
          retention-days: 14
      # Hover Cloud (optional): add the HOVER_INGEST_TOKEN repo secret (from
      # cloud.gethover.dev → your project) and results flow to the dashboard +
      # heal queue. \`env\` tags which environment ran — 'ci' for this in-CI
      # localhost boot; set the HOVER_ENV repo variable to 'staging' / 'prod'
      # if you pointed BASE_URL at a deployment. Best-effort by design: a cloud
      # hiccup must never red your build.
      - name: Report to Hover Cloud
        if: \${{ !cancelled() }}
        env:
          HOVER_INGEST_TOKEN: \${{ secrets.HOVER_INGEST_TOKEN }}
          HOVER_CLOUD_URL: \${{ vars.HOVER_CLOUD_URL || 'https://cloud.gethover.dev' }}
          HOVER_ENV: \${{ vars.HOVER_ENV || 'ci' }}
        run: |
          if [ -z "$HOVER_INGEST_TOKEN" ] || [ ! -f hover-results.json ]; then
            echo "Hover Cloud reporting off (no HOVER_INGEST_TOKEN secret) — skipping."; exit 0
          fi
          curl -sS --max-time 30 -X POST \\
            -H "Authorization: Bearer $HOVER_INGEST_TOKEN" \\
            -H "Content-Type: application/json" \\
            --data-binary @hover-results.json \\
            "$HOVER_CLOUD_URL/api/ingest?source=\${{ github.event_name }}&env=$HOVER_ENV&branch=\${{ github.head_ref || github.ref_name }}&sha=\${{ github.event.pull_request.head.sha || github.sha }}&ci_url=\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}" \\
            || echo "Hover Cloud unreachable — results stay in the artifact."`;

  const header = `# Generated by Hover. Runs your crystallized Playwright specs${sharded ? ` across ${shards} parallel shards` : ''} —
# no AI in the loop, just deterministic tests. A red check = a real regression.${sharded ? '\n# NOTE: sharding uses `playwright merge-reports`; confirm the first run merges cleanly.' : ''}
name: Hover E2E
on:
  pull_request:
  workflow_dispatch:${scheduleTrigger}
# Cancel a superseded run when new commits land on the same ref.
concurrency:
  group: hover-e2e-\${{ github.ref }}
  cancel-in-progress: true
# Needed for the visual-baseline review PR (and self-heal): push a branch + open a PR.
permissions:
  contents: write
  pull-requests: write
jobs:`;

  const footer = `#
# Testing a deployed URL instead of building in CI? Delete the "Start the app"
# + "Wait for the app" steps and point BASE_URL at your deployment — or use a
# per-environment GitHub Environment secret for staging / prod.
`;

  if (!sharded) {
    return `${header}
  e2e:
    runs-on: ubuntu-latest
    env:
      BASE_URL: ${o.appUrl}
    steps:
${runnerSetup}
      - name: Run Hover specs
        # --update-snapshots=missing: a visual spec with no baseline yet gets one
        # written HERE (in CI's Linux env, so it actually matches future runs);
        # existing baselines are pixel-compared, never overwritten.
        run: ${pm.exec} playwright test __vibe_tests__ --update-snapshots=missing --reporter=html,json
        env:
          PLAYWRIGHT_JSON_OUTPUT_NAME: hover-results.json
${secretEnv}
${uploads}
${reportStep}
${baselinePr}
${footer}`;
  }

  const shardList = Array.from({ length: shards }, (_, i) => i + 1).join(', ');
  return `${header}
  e2e:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [${shardList}]
    env:
      BASE_URL: ${o.appUrl}
    steps:
${runnerSetup}
      - name: Run Hover specs (shard \${{ matrix.shard }}/${shards})
        # Sharded: create missing visual baselines so specs don't error. Auto
        # baseline-PR is skipped here (shards would race); generate baselines via
        # a non-sharded workflow_dispatch run, or commit them once locally on Linux.
        run: ${pm.exec} playwright test __vibe_tests__ --update-snapshots=missing --shard=\${{ matrix.shard }}/${shards} --reporter=blob
        env:
${secretEnv}
      - name: Upload blob report
        uses: actions/upload-artifact@v4
        if: \${{ !cancelled() }}
        with:
          name: blob-report-\${{ matrix.shard }}
          path: blob-report/
          retention-days: 1
  merge:
    needs: [e2e]
    if: \${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${setupBlock}      - uses: actions/setup-node@v4
        with:
          node-version: 20${cacheLine}
      - run: ${pm.install}
      - name: Download shard reports
        uses: actions/download-artifact@v4
        with:
          path: all-blob-reports
          pattern: blob-report-*
          merge-multiple: true
      - name: Merge into one report
        run: ${pm.exec} playwright merge-reports --reporter=html,json ./all-blob-reports
        env:
          PLAYWRIGHT_JSON_OUTPUT_NAME: hover-results.json
${uploads}
${reportStep}
${footer}`;
}

/**
 * Self-heal mode B2 — the OPT-IN, AI-in-CI repair workflow. Runs ONLY when the
 * Hover E2E workflow fails AND the user opted in (secret ANTHROPIC_API_KEY + repo
 * variable HOVER_AUTOHEAL=true). It boots the app, drives it with Claude Code +
 * the Hover MCP to re-ground the drifted specs, and opens a PR with the healed
 * specs for human review — never auto-merging.
 *
 * Moat: the green CI path stays 100% AI-free. This is a failure-only, opt-in,
 * human-reviewed maintenance job that runs the USER's own agent + key (BYO-CLI).
 *
 * This is a best-effort TEMPLATE — headless Chrome-over-CDP + `claude -p` in CI
 * may need per-project tuning (browser deps, boot time, auth). The generated
 * file says so; treat the first runs as validation.
 */
export function buildAutohealWorkflowYaml(o: CiWorkflowOptions): string {
  const pm = pmConfig(o.packageManager);
  const setupBlock = pm.setup.length ? pm.setup.join('\n') + '\n' : '';
  const cacheLine = pm.cache ? `\n          cache: ${pm.cache}` : '';
  // Login secrets the heal drive may need, exposed to the `claude` step.
  const secretEnv = o.secretNames.length
    ? o.secretNames.map((n) => `          ${n}: \${{ secrets.${n} }}`).join('\n')
    : '          # No test-account secrets — add accounts in the Hover Environments view if login is needed.';

  return `# Generated by Hover — self-heal mode B2 (OPT-IN, AI-in-CI repair).
#
# Runs ONLY when "Hover E2E" fails AND you've opted in:
#   1. Repo secret  ANTHROPIC_API_KEY  = your Anthropic API key
#   2. Repo variable HOVER_AUTOHEAL     = true
# It boots your app, drives it with Claude Code + the Hover MCP to re-ground the
# specs that drifted, and opens a PR with the healed specs for you to REVIEW.
# It NEVER auto-merges. Your green CI stays 100% AI-free — this is a failure-only,
# opt-in, human-reviewed job that runs YOUR own agent + key (BYO-CLI).
#
# TEMPLATE: headless Chrome-over-CDP + \`claude -p\` in CI can need tuning for your
# project (browser deps, app boot time, auth secrets). Treat the first runs as
# validation, and read the healed PR's diff carefully before merging.
name: Hover Auto-Heal
on:
  workflow_run:
    workflows: ["Hover E2E"]
    types: [completed]
jobs:
  autoheal:
    # Only on a FAILED run, and only when explicitly opted in.
    if: \${{ github.event.workflow_run.conclusion == 'failure' && vars.HOVER_AUTOHEAL == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    env:
      BASE_URL: ${o.appUrl}
      HOVER_TARGET: ${o.appUrl}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.workflow_run.head_branch }}
${setupBlock}      - uses: actions/setup-node@v4
        with:
          node-version: 20${cacheLine}
      - run: ${pm.install}
      - run: ${pm.exec} playwright install --with-deps chromium
      - name: Ensure axe-core (only if a11y specs exist)
        run: |
          if [ -d __vibe_tests__/a11y ] && [ -z "$(node -e "try{require.resolve('@axe-core/playwright');process.stdout.write('ok')}catch{}" )" ]; then
            npm i --no-save @axe-core/playwright
          fi
      - name: Start the app
        run: ${o.packageManager} run ${o.devScript} &
      - name: Wait for the app
        run: npx --yes wait-on "$BASE_URL" --timeout 120000
      - name: Install Hover MCP + Claude Code
        run: npm i -g @hover-dev/mcp @anthropic-ai/claude-code
      - name: Register the Hover MCP
        run: claude mcp add hover -e HOVER_TARGET=$BASE_URL -e HOVER_PROJECT_ROOT=$PWD -- hover-mcp
      - name: Heal drifted specs (Claude + Hover MCP)
        # xvfb gives the MCP-launched debug Chrome a display. skip-permissions is
        # acceptable here: an ephemeral runner on a throwaway branch, tools scoped
        # to Hover's MCP. The heal replays each spec, re-grounds what drifted.
        run: xvfb-run -a claude -p "/mcp__hover__heal" --dangerously-skip-permissions --allowedTools "mcp__hover__*"
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
${secretEnv}
      - name: Open a heal PR if any spec changed
        env:
          GH_TOKEN: \${{ github.token }}
          HEAD_BRANCH: \${{ github.event.workflow_run.head_branch }}
        run: |
          if [ -z "$(git status --porcelain __vibe_tests__)" ]; then
            echo "Nothing healed — no spec changes."; exit 0
          fi
          BRANCH="hover/autoheal-\${{ github.run_id }}"
          git config user.name "hover-autoheal"
          git config user.email "hover-autoheal@users.noreply.github.com"
          git checkout -b "$BRANCH"
          git add __vibe_tests__
          git commit -m "fix(tests): self-heal drifted specs (review before merge)"
          git push origin "$BRANCH"
          gh pr create --base "$HEAD_BRANCH" --head "$BRANCH" \\
            --title "🏥 Hover auto-heal: re-grounded drifted specs" \\
            --body "Hover re-grounded specs that drifted on the failed E2E run, using your own Claude + the Hover MCP. **Review the diff**: confirm each change re-locates the SAME control (a rename / move) and didn't heal away a real bug. No auto-merge."
`;
}
