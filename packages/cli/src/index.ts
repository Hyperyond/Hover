#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectFramework,
  detectPackageManager,
  findWorkspaces,
  isMonorepoRoot,
  readUserPackageJson,
  type PackageJson,
} from './detect.js';
import { findFrameworkById, FRAMEWORKS, type Framework, type FrameworkId } from './frameworks.js';
import { installPackage } from './install.js';
import { mutateConfig } from './mutate.js';
import { isInteractive, pick } from './picker.js';
import { bold, cyan, dim, err, info, ok, spark, warn } from './log.js';
import { parseReRecordArgs, runReRecord } from './re-record.js';
import { runExtract } from './extract.js';

/**
 * @hover-dev/cli entrypoint.
 *
 * Usage:
 *   npx @hover-dev/cli add                # auto-detect bundler, install, wire
 *   npx @hover-dev/cli add --vite         # force a specific bundler
 *   npx @hover-dev/cli add --astro
 *   npx @hover-dev/cli add --nuxt
 *   npx @hover-dev/cli add --webpack
 *   npx @hover-dev/cli add --dry-run      # show what would happen, change nothing
 *   npx @hover-dev/cli --help             # usage
 *   npx @hover-dev/cli --version
 *
 * We parse argv by hand rather than pulling in commander/yargs — the CLI
 * is tiny, dependencies cost cold-start time on first npx invocation, and
 * the surface is unlikely to grow into something that needs a real parser.
 */

interface ParsedArgs {
  command: string | null;
  framework: FrameworkId | null;
  cwd: string | null;
  dryRun: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: null,
    framework: null,
    cwd: null,
    dryRun: false,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--version' || arg === '-v') out.version = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--cwd' || arg === '-C') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        err(`${arg} requires a directory argument.`);
        process.exit(2);
      }
      out.cwd = next;
      i++;
    } else if (arg.startsWith('--cwd=')) {
      out.cwd = arg.slice('--cwd='.length);
    } else if (arg.startsWith('--')) {
      const candidate = arg.slice(2) as FrameworkId;
      if (FRAMEWORKS.some(f => f.id === candidate)) {
        out.framework = candidate;
      } else {
        err(`Unknown flag: ${arg}`);
        process.exit(2);
      }
    } else if (!out.command) {
      out.command = arg;
    } else {
      err(`Unexpected positional argument: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

function printUsage(): void {
  console.log(`${bold('@hover-dev/cli')} — wire Hover into your dev workflow

Usage:
  npx @hover-dev/cli add                ${dim('# auto-detect bundler, install, wire')}
  npx @hover-dev/cli add --vite         ${dim('# force a specific bundler')}
  npx @hover-dev/cli add --astro
  npx @hover-dev/cli add --nuxt
  npx @hover-dev/cli add --next
  npx @hover-dev/cli add --webpack
  npx @hover-dev/cli add --cwd apps/web ${dim('# target a specific workspace')}
  npx @hover-dev/cli add --dry-run      ${dim('# show what would happen, change nothing')}

  npx @hover-dev/cli re-record <spec>   ${dim('# regenerate a Playwright spec against the current UI')}
  npx @hover-dev/cli re-record --dry-run <spec>
  npx @hover-dev/cli extract            ${dim('# lift flows shared across specs into Page Objects + fixtures')}
  npx @hover-dev/cli --help
  npx @hover-dev/cli --version

What it does:
  1. Detects your bundler (Vite / Astro / Nuxt / Next / Webpack) from package.json.
  2. Detects your package manager (pnpm / yarn / bun / npm) from your lockfile.
  3. Installs the matching Hover integration as a dev dependency.
  4. Adds the plugin/integration to your config file.

Monorepo support (turbo / pnpm-workspace / yarn workspaces):
  Run from the repo root. If exactly one workspace declares a supported
  bundler, the CLI dispatches into it automatically. If several do, an
  interactive picker (↑/↓, Enter) appears in a TTY — or in non-TTY
  contexts (CI) the CLI lists candidates and asks you to re-run with
  --cwd <path>.

For more: https://github.com/Hyperyond/Hover
`);
}

async function runAdd(args: ParsedArgs): Promise<number> {
  // --cwd lets the user point us at an app inside a monorepo without changing
  // shell directories. Resolve it before walking up so we land in the right
  // package, not the parent monorepo root.
  const startDir = args.cwd
    ? (isAbsolute(args.cwd) ? args.cwd : resolve(process.cwd(), args.cwd))
    : process.cwd();
  if (args.cwd && !existsSync(startDir)) {
    err(`--cwd path does not exist: ${startDir}`);
    return 1;
  }

  const found = readUserPackageJson(startDir);
  if (!found) {
    err(`No package.json found in ${startDir} or any parent.`);
    err(`Run this command from your project root, or run \`npm init\` first.`);
    return 1;
  }
  let { pkg, rootDir } = found;

  // Step 1: pick framework. Explicit flag wins. Otherwise, when the
  // detected root is a monorepo and the root package.json itself doesn't
  // declare a bundler, look inside the declared workspaces and use the
  // unique one that does. Multiple matches → ask the user to disambiguate.
  let framework: Framework | null = args.framework
    ? findFrameworkById(args.framework)!
    : detectFramework(pkg);

  if (!framework && !args.cwd && isMonorepoRoot(rootDir, pkg)) {
    const workspaces = findWorkspaces(rootDir, pkg);
    const matches: { dir: string; pkg: PackageJson; framework: Framework }[] = [];
    for (const wsDir of workspaces) {
      try {
        const wsPkgRaw = readFileSync(join(wsDir, 'package.json'), 'utf-8');
        const wsPkg = JSON.parse(wsPkgRaw) as PackageJson;
        const f = detectFramework(wsPkg);
        if (f) matches.push({ dir: wsDir, pkg: wsPkg, framework: f });
      } catch { /* skip unreadable workspace */ }
    }
    if (matches.length === 1) {
      const m = matches[0];
      info(
        `Monorepo detected — using workspace ${bold(relative(rootDir, m.dir) || '.')} ` +
        `(${m.framework.label}).`,
      );
      rootDir = m.dir;
      pkg = m.pkg;
      framework = m.framework;
    } else if (matches.length > 1) {
      // Interactive picker when running in a TTY; non-interactive fall-back
      // (CI, piped invocations) prints the list and asks for --cwd. The
      // picker's own isInteractive() check is duplicated here so the
      // non-TTY branch can print a more specific message + non-zero exit.
      if (isInteractive()) {
        info(`Monorepo detected — found ${matches.length} candidate workspaces.`);
        const picked = await pick({
          title: 'Which workspace should Hover wire into?',
          items: matches.map(m => ({
            label: `${relative(rootDir, m.dir) || '.'}  (${m.framework.label})`,
            detail: m.dir,
            value: m,
          })),
        });
        if (!picked) {
          warn(`Cancelled.`);
          return 130; // 128 + SIGINT, conventional cancel exit code
        }
        rootDir = picked.dir;
        pkg = picked.pkg;
        framework = picked.framework;
        info(`Wiring ${bold(framework.label)} into ${cyan(relative(process.cwd(), rootDir) || '.')}.`);
      } else {
        err(`Monorepo detected with ${matches.length} candidate workspaces:`);
        for (const m of matches) {
          info(`  - ${cyan(relative(rootDir, m.dir))} (${m.framework.label})`);
        }
        info(`Pick one with --cwd <path>, e.g.:`);
        info(`  npx @hover-dev/cli add --cwd ${relative(rootDir, matches[0].dir)}`);
        return 1;
      }
    }
  }

  if (!framework) {
    err(`Couldn't detect a supported bundler in package.json.`);
    if (isMonorepoRoot(rootDir, pkg)) {
      info(`This looks like a monorepo root but no workspace declares a supported bundler.`);
      info(`If your app lives elsewhere, point us at it: --cwd <path>.`);
    }
    info(`Supported: ${FRAMEWORKS.map(f => f.id).join(', ')}.`);
    info(`Force one with --vite / --astro / --nuxt / --next / --webpack.`);
    return 1;
  }
  if (args.framework) {
    info(`Using ${bold(framework.label)} (forced via --${framework.id}).`);
  } else if (!args.cwd) {
    // Quietly omit the "Detected …" line in monorepo-dispatch mode — the
    // workspace-selection line above already told the user what we picked.
    if (rootDir === (args.cwd ?? startDir) || rootDir === startDir) {
      info(`Detected ${bold(framework.label)} project.`);
    }
  } else {
    info(`Detected ${bold(framework.label)} project at ${cyan(rootDir)}.`);
  }

  // Step 2: pick package manager.
  const { pm, reason } = detectPackageManager(rootDir);
  info(`Using package manager: ${bold(pm)} ${dim(`(${reason})`)}.`);

  if (args.dryRun) {
    warn(`Dry-run — not installing or modifying files.`);
    info(`Would install: ${cyan(framework.hoverPackage)} (dev dependency, via ${pm}).`);
    info(`Would mutate: ${cyan(framework.configCandidates[0])} (or whichever candidate exists).`);
    return 0;
  }

  // Step 3: install the right Hover package as a dev dependency.
  info(`Installing ${cyan(framework.hoverPackage)} ...`);
  const installCode = await installPackage(pm, framework.hoverPackage, rootDir);
  if (installCode !== 0) {
    err(`Package manager exited with code ${installCode}. Aborting.`);
    return installCode;
  }
  ok(`Installed ${framework.hoverPackage}.`);

  // Step 4: wire the plugin into the config file.
  info(`Wiring into ${cyan(framework.configCandidates[0])} ...`);
  const result = await mutateConfig(rootDir, framework);
  switch (result.kind) {
    case 'ok':
      if (result.alreadyWired) {
        ok(`${result.configPath} already wired — left as-is.`);
      } else {
        ok(`Updated ${result.configPath}.`);
      }
      break;
    case 'manual':
      warn(`Couldn't update your config automatically: ${result.reason}.`);
      console.log(result.instructions);
      break;
    case 'error':
      warn(`Skipped config update — magicast couldn't safely mutate the file.`);
      warn(`Reason: ${result.reason}`);
      console.log(result.instructions);
      break;
  }

  // Next.js needs one extra manual step the CLI cannot safely do: render
  // `<HoverScript />` in `app/layout.tsx`. Modifying JSX in user code with
  // ASTs invites whitespace drift and Server Component shape surprises;
  // the instruction is short, so we print it and let the human paste it.
  if (framework.id === 'next' && result.kind === 'ok' && !result.alreadyWired) {
    info(`One last step — add ${cyan('<HoverScript />')} to your ${cyan('app/layout.tsx')}:`);
    console.log(`
  import { HoverScript } from '@hover-dev/next';

  export default function RootLayout({ children }) {
    return (
      <html>
        <body>
          {children}
          <HoverScript />
        </body>
      </html>
    );
  }
`);
  }

  spark(`Done. Run your dev server and click the floating ✨.`);
  return 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (args.version) {
    // Read version from our own package.json at runtime so we don't bake a
    // string into source that drifts from package.json. Walk up from
    // src/ or dist/ until we find the package's own package.json.
    const here = dirname(fileURLToPath(import.meta.url));
    let dir = here;
    while (dir !== '/' && !existsSync(join(dir, 'package.json'))) dir = dirname(dir);
    const own = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { version: string };
    console.log(own.version);
    return;
  }
  if (args.command === 'add') {
    const code = await runAdd(args);
    process.exit(code);
  }
  if (args.command === 're-record') {
    // re-record has its own argv shape — re-parse from the slice after the
    // subcommand. The main parser only knows about `add`'s flags.
    const subArgv = process.argv.slice(3);
    const { args: subArgs, exitCode } = parseReRecordArgs(subArgv);
    if (!subArgs) process.exit(exitCode);
    const code = await runReRecord(subArgs);
    process.exit(code);
  }
  if (args.command === 'extract') {
    // extract only needs --cwd (which the main parser already understands);
    // the 3-spec threshold is fixed for now, so no sub-parser is required.
    const code = await runExtract({ cwd: args.cwd, minSpecs: 3 });
    process.exit(code);
  }
  if (!args.command) {
    printUsage();
    process.exit(0);
  }
  err(`Unknown command: ${args.command}`);
  printUsage();
  process.exit(2);
}

main().catch(e => {
  err(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
