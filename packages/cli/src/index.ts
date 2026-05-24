#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFramework, detectPackageManager, readUserPackageJson } from './detect.js';
import { findFrameworkById, FRAMEWORKS, type FrameworkId } from './frameworks.js';
import { installPackage } from './install.js';
import { mutateConfig } from './mutate.js';
import { bold, cyan, dim, err, info, ok, spark, warn } from './log.js';

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
  dryRun: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: null,
    framework: null,
    dryRun: false,
    help: false,
    version: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--version' || arg === '-v') out.version = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--')) {
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
  npx @hover-dev/cli add              ${dim('# auto-detect bundler, install, wire')}
  npx @hover-dev/cli add --vite       ${dim('# force a specific bundler')}
  npx @hover-dev/cli add --astro
  npx @hover-dev/cli add --nuxt
  npx @hover-dev/cli add --next
  npx @hover-dev/cli add --webpack
  npx @hover-dev/cli add --dry-run    ${dim('# show what would happen, change nothing')}
  npx @hover-dev/cli --help
  npx @hover-dev/cli --version

What it does:
  1. Detects your bundler (Vite / Astro / Nuxt / Next / Webpack) from package.json.
  2. Detects your package manager (pnpm / yarn / bun / npm) from your lockfile.
  3. Installs the matching Hover integration as a dev dependency.
  4. Adds the plugin/integration to your config file.

For more: https://github.com/Hyperyond/Hover
`);
}

async function runAdd(args: ParsedArgs): Promise<number> {
  const found = readUserPackageJson();
  if (!found) {
    err(`No package.json found in the current directory or any parent.`);
    err(`Run this command from your project root, or run \`npm init\` first.`);
    return 1;
  }
  const { pkg, rootDir } = found;

  // Step 1: pick framework — explicit flag wins over detection.
  const framework = args.framework
    ? findFrameworkById(args.framework)!
    : detectFramework(pkg);
  if (!framework) {
    err(`Couldn't detect a supported bundler in package.json.`);
    info(`Supported: ${FRAMEWORKS.map(f => f.id).join(', ')}.`);
    info(`Force one with --vite / --astro / --nuxt / --next / --webpack.`);
    return 1;
  }
  if (args.framework) {
    info(`Using ${bold(framework.label)} (forced via --${framework.id}).`);
  } else {
    info(`Detected ${bold(framework.label)} project.`);
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
