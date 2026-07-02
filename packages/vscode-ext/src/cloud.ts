/**
 * Hover Cloud pull channel — the extension side of cloud → editor heal routing.
 *
 * Cloud queues a heal request per spec that drifted in CI; nothing in the cloud
 * can reach this machine, so the extension POLLS the queue and notifies. The
 * heal itself stays the existing local hand-off: copy `/mcp__hover__heal <slug>`
 * for the user's own agent, human reviews the diff. A queue entry closes only
 * when CI sees the spec pass again — never on an editor claim.
 *
 * Credentials live in ~/.hover/credentials.json (written by "Hover: Connect
 * Hover Cloud", 0600) so the Hover MCP shares the same sign-in. Deliberately
 * NOT VS Code SecretStorage — that store is extension-private and would lock
 * the account away from the MCP server.
 */
import * as vscode from 'vscode';
import {
  DEFAULT_CLOUD_URL,
  fetchHealRequests,
  healSlug,
  readCloudCredentials,
  writeCloudCredentials,
  type CloudHealRequest,
} from '@hover-dev/core/cloud';

const POLL_MS = 5 * 60_000;

export function registerCloud(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('hover.connectCloud', () => connectCloud()),
  );
  void pollCloud();
  const timer = setInterval(() => void pollCloud(), POLL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function cloudUrl(): string {
  return (
    vscode.workspace.getConfiguration('hover').get<string>('cloudUrl')?.replace(/\/$/, '') ||
    DEFAULT_CLOUD_URL
  );
}

/** Browser-assisted connect: mint a PAT on the cloud settings page, paste it
 *  here; validated against the API before it's persisted for every surface. */
async function connectCloud(): Promise<void> {
  const url = cloudUrl();
  const open = 'Open Hover Cloud settings';
  const pick = await vscode.window.showInformationMessage(
    'Hover: mint a personal access token at Hover Cloud → Settings → Access tokens, then paste it here.',
    open,
    'I have a token',
  );
  if (!pick) return;
  if (pick === open) {
    await vscode.env.openExternal(vscode.Uri.parse(`${url}/dashboard/settings`));
  }
  const token = (
    await vscode.window.showInputBox({
      prompt: 'Paste your Hover Cloud access token',
      placeHolder: 'hover_pat_…',
      password: true,
      ignoreFocusOut: true,
    })
  )?.trim();
  if (!token) return;

  try {
    await fetchHealRequests({ token, url }, { status: 'open' });
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Hover: that token didn't work against ${url} — ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
    );
    return;
  }

  const p = writeCloudCredentials({ token, url });
  void vscode.window.showInformationMessage(
    `Hover: connected to Hover Cloud. Credentials saved to ${p} — the Hover MCP picks them up automatically.`,
  );
  void pollCloud();
}

let polling = false; // re-entrancy guard — a slow sweep must not stack
const notified = new Set<string>(); // request ids already surfaced this session

async function pollCloud(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const creds = readCloudCredentials();
    if (!creds) return; // not connected — the connect command is the opt-in
    const open = await fetchHealRequests(creds, { status: 'open' });
    const fresh = open.filter((r) => !notified.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) notified.add(r.id);
    void notifyDrift(fresh);
  } catch {
    // transient (offline, cloud hiccup) — the next tick retries
  } finally {
    polling = false;
  }
}

/** Surface newly-queued CI drift and hand off to the agent — same clipboard
 *  hand-off as the 🏥 Heal command; the cockpit drives no agent. */
async function notifyDrift(fresh: CloudHealRequest[]): Promise<void> {
  const slugs = [...new Set(fresh.map((r) => healSlug(r.specFile)))];
  const label =
    slugs.length === 1 ? `"${slugs[0]}" drifted in CI` : `${slugs.length} specs drifted in CI`;
  const healAction = 'Copy heal command';
  const pick = await vscode.window.showWarningMessage(
    `Hover Cloud: ${label}.`,
    healAction,
    'View in Cloud',
  );
  if (pick === 'View in Cloud') {
    await vscode.env.openExternal(vscode.Uri.parse(`${cloudUrl()}/dashboard`));
    return;
  }
  if (pick !== healAction) return;

  let slug: string | undefined = slugs[0];
  if (slugs.length > 1) {
    slug = await vscode.window.showQuickPick(slugs, {
      placeHolder: 'Which spec should your agent heal first?',
    });
  }
  if (!slug) return;
  const cmd = `/mcp__hover__heal ${slug}`;
  await vscode.env.clipboard.writeText(cmd);
  void vscode.window.showInformationMessage(
    `Hover: copied "${cmd}" — paste it into your coding agent (Claude Code). Review the diff before keeping the heal; the queue entry closes when CI sees it pass.`,
  );
}
