/**
 * Shared location logic for optimization candidates.
 *
 * The optimize pass writes a candidate next to (never over) the original spec
 * at `<workspace>/.hover/cache/optimized/<spec-filename>.draft`. Both the
 * CodeLens (specLens.ts) and the diff commands (extension.ts) need the same
 * path + existence check, so they live here once.
 */
import * as vscode from 'vscode';
import * as path from 'node:path';

const OPTIMIZED_DIR = ['.hover', 'cache', 'optimized'];
const DRAFT_SUFFIX = '.draft';

/** The candidate draft URI for a spec, or undefined if the spec is outside any
 *  open workspace folder. */
export function candidateUri(specUri: vscode.Uri): vscode.Uri | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(specUri);
  if (!folder) return undefined;
  return vscode.Uri.joinPath(folder.uri, ...OPTIMIZED_DIR, path.basename(specUri.fsPath) + DRAFT_SUFFIX);
}

export async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
