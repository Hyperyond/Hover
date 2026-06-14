/**
 * `@hover-dev/vscode-ext` — Hover's VSCode extension entry.
 *
 * Per the security-direction design (`2026-06-14-security-direction-design.md`,
 * §3.2) this is Hover's **primary surface**: a thin GUI face over the
 * agent-agnostic engine in `@hover-dev/cli` / `@hover-dev/core`. It must stay a
 * *surface* — it never re-implements the engine, and saved artifacts stay plain
 * `@playwright/test`.
 *
 * This scaffold registers the highest-leverage feature first — F1 from the
 * VSCode feature assessment (`2026-06-06-vscode-extension-design.md`): a native
 * side-by-side review of an optimization candidate against the live spec. The
 * engine writes candidates to `<workspaceRoot>/.hover/cache/optimized/`; this
 * command opens VSCode's built-in diff editor over the pair.
 */
import * as vscode from 'vscode';
import * as path from 'node:path';
import { connectServicePool } from './serviceClient.js';
import { SpecLensProvider } from './specLens.js';

/**
 * Where the optimizer writes its candidate, relative to the workspace root. The
 * authoritative path is `@hover-dev/core`'s `optimizeSpec.ts`:
 * `.hover/cache/optimized/<spec>.draft` (the candidate keeps the full
 * `<slug>.spec.ts` name plus a `.draft` suffix, never overwriting the original).
 */
const OPTIMIZED_DIR = ['.hover', 'cache', 'optimized'];
const DRAFT_SUFFIX = '.draft';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'hover.reviewOptimizationCandidate',
      (uri?: vscode.Uri) => reviewOptimizationCandidate(uri),
    ),
    vscode.commands.registerCommand(
      'hover.openSource',
      (source?: string) => openSource(source),
    ),
    vscode.commands.registerCommand('hover.newProbeSeed', () => newProbeSeed()),
    // F3 — spec-lifecycle CodeLens on crystallized specs (both *.spec.ts and
    // *.security.spec.ts match this glob).
    vscode.languages.registerCodeLensProvider(
      { language: 'typescript', scheme: 'file', pattern: '**/*.spec.ts' },
      new SpecLensProvider(),
    ),
  );

  // F2 transport: listen for `reveal-source` relayed by any running Hover
  // service and jump the editor there. The pool reconnects across HMR.
  const pool = connectServicePool((source) => {
    void openSource(source);
  });
  context.subscriptions.push({ dispose: () => pool.dispose() });
}

export function deactivate(): void {
  /* nothing to tear down yet */
}

/**
 * F1 — open `vscode.diff` between a spec and its optimization candidate. Falls
 * back to the active editor's document when invoked without an explicit URI
 * (command palette), so it works both from the editor title bar and the palette.
 */
async function reviewOptimizationCandidate(uri?: vscode.Uri): Promise<void> {
  const specUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!specUri || specUri.scheme !== 'file') {
    void vscode.window.showWarningMessage('Hover: open a spec file to review its optimization candidate.');
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(specUri);
  if (!folder) {
    void vscode.window.showWarningMessage('Hover: the spec is not inside an open workspace folder.');
    return;
  }

  const fileName = path.basename(specUri.fsPath);
  const candidate = vscode.Uri.joinPath(folder.uri, ...OPTIMIZED_DIR, fileName + DRAFT_SUFFIX);

  try {
    await vscode.workspace.fs.stat(candidate);
  } catch {
    void vscode.window.showInformationMessage(
      `Hover: no optimization candidate for ${fileName}. Run \`hover optimize\` first.`,
    );
    return;
  }

  await vscode.commands.executeCommand(
    'vscode.diff',
    specUri,
    candidate,
    `Hover · ${fileName} ↔ optimized`,
    { preview: true } satisfies vscode.TextDocumentShowOptions,
  );
}

/**
 * F2 (editor-side half) — reveal the source location behind a page element.
 *
 * `@hover-dev/transform-source` stamps every host element with
 * `data-hover-source="<rel-path>:<line>:<col>"`. This command takes that value
 * and jumps the editor to the exact line/col. The page→editor transport (a
 * click in the running app surfacing the attribute to the extension) is the
 * follow-on; for now the command accepts the value directly (from a future
 * message) or prompts for it, so the editor capability is testable standalone.
 */
async function openSource(source?: string): Promise<void> {
  let value = source;
  if (!value) {
    value = await vscode.window.showInputBox({
      title: 'Hover: open source',
      prompt: 'Paste a data-hover-source value',
      placeHolder: 'src/components/Login.tsx:42:5',
    });
  }
  const parsed = value ? parseHoverSource(value) : null;
  if (!parsed) {
    if (value) void vscode.window.showWarningMessage(`Hover: "${value}" is not a valid path:line:col source.`);
    return;
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showWarningMessage('Hover: open a workspace folder to resolve the source path.');
    return;
  }

  // The attribute is a workspace-relative POSIX path; try each folder root.
  const target = await firstExisting(folders.map(f => vscode.Uri.joinPath(f.uri, parsed.path)));
  if (!target) {
    void vscode.window.showWarningMessage(`Hover: could not find ${parsed.path} in the open workspace.`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument(target);
  const editor = await vscode.window.showTextDocument(doc);
  // data-hover-source is 1-indexed (line + column); VSCode Position is 0-indexed.
  const pos = new vscode.Position(Math.max(0, parsed.line - 1), Math.max(0, parsed.col - 1));
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

/** Parse a `data-hover-source` value `<rel-path>:<line>:<col>` (1-indexed).
 *  The path may itself contain colons only on Windows-absolute paths, which the
 *  attribute never carries (it's a workspace-relative POSIX path), so anchoring
 *  the two trailing `:<num>` groups is unambiguous. */
export function parseHoverSource(value: string): { path: string; line: number; col: number } | null {
  const m = /^(.+):(\d+):(\d+)$/.exec(value.trim());
  if (!m) return null;
  return { path: m[1], line: Number(m[2]), col: Number(m[3]) };
}

/**
 * F4 — scaffold a new security probe seed under `.hover/rules/security/`. The
 * file is schema-validated as you edit it (see contributes.jsonValidation), so
 * authoring a probe is fill-in-the-blanks rather than reading the engine source.
 */
async function newProbeSeed(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showWarningMessage('Hover: open a workspace folder to create a seed.');
    return;
  }
  const name = await vscode.window.showInputBox({
    title: 'Hover: new probe seed',
    prompt: 'Seed name (kebab-case)',
    placeHolder: 'idor-numeric-id',
    validateInput: (v) => (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.trim()) ? null : 'Use kebab-case: lower-case letters, digits, hyphens.'),
  });
  if (!name) return;
  const slug = name.trim();

  const target = vscode.Uri.joinPath(folders[0].uri, '.hover', 'rules', 'security', `${slug}.json`);
  if (await firstExisting([target])) {
    void vscode.window.showWarningMessage(`Hover: a seed named "${slug}" already exists.`);
    await vscode.window.showTextDocument(target);
    return;
  }

  const template = {
    name: slug,
    class: 'idor',
    category: 'authz',
    note: '',
    match: { method: ['GET'], urlParam: '/REPLACE/\\d+', needsAuth: true },
    probe: {
      strategy: "swap the id for another user's id and replay",
      signal: "200 OK returning the other user's record",
      secondIdentity: true,
    },
  };
  const body = JSON.stringify(template, null, 2) + '\n';
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf-8'));
  await vscode.window.showTextDocument(target);
}

/** Return the first URI that exists on disk, or undefined if none do. */
async function firstExisting(uris: vscode.Uri[]): Promise<vscode.Uri | undefined> {
  for (const uri of uris) {
    try {
      await vscode.workspace.fs.stat(uri);
      return uri;
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}
