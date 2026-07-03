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
import { rmSync } from 'node:fs';
import {
  CloudApiError,
  DEFAULT_CLOUD_URL,
  claimDeviceLink,
  credentialsPath,
  fetchHealRequests,
  healSlug,
  readCloudCredentials,
  startDeviceLink,
  writeCloudCredentials,
  type CloudHealRequest,
} from '@hover-dev/core/cloud';

const POLL_MS = 5 * 60_000;

export function registerCloud(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('hover.connectCloud', () => connectCloud()),
    vscode.commands.registerCommand('hover.disconnectCloud', () => disconnectCloud()),
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

/** Device-link connect: the browser approves a short code and the token comes
 *  back over a one-shot claim — nothing to copy. Paste stays as the fallback
 *  (air-gapped browser, self-hosted cloud without /link, etc.). */
async function connectCloud(): Promise<void> {
  const url = cloudUrl();

  let link;
  try {
    link = await startDeviceLink(url, `vscode · ${vscode.env.machineId.slice(0, 6)}`);
  } catch {
    // Older/self-hosted cloud without the device-link endpoints.
    return connectCloudByPaste(url);
  }

  await vscode.env.openExternal(vscode.Uri.parse(link.verificationUrl));

  const token = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Hover Cloud: approve code ${link.userCode} in the browser…`,
      cancellable: true,
    },
    async (_progress, cancel): Promise<string | null> => {
      const deadline = Date.now() + link.expiresIn * 1000;
      while (Date.now() < deadline && !cancel.isCancellationRequested) {
        await new Promise((r) => setTimeout(r, Math.max(2, link.interval) * 1000));
        try {
          const t = await claimDeviceLink(url, link.deviceCode);
          if (t) return t;
        } catch (e) {
          if (e instanceof CloudApiError && e.status === 410) return null; // expired
          // transient — keep polling until the deadline
        }
      }
      return null;
    },
  );

  if (!token) {
    const paste = 'Paste a token instead';
    const pick = await vscode.window.showWarningMessage(
      'Hover: the browser approval didn’t complete.',
      'Try again',
      paste,
    );
    if (pick === 'Try again') return connectCloud();
    if (pick === paste) return connectCloudByPaste(url);
    return;
  }

  await finishConnect(url, token);
}

/** Fallback connect: mint a PAT on the cloud settings page and paste it. */
async function connectCloudByPaste(url: string): Promise<void> {
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
  await finishConnect(url, token);
}

/** Validate against the API, persist for every surface, kick the panel. */
async function finishConnect(url: string, token: string): Promise<void> {
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
  void vscode.commands.executeCommand('hover.refreshDashboard'); // pull CI runs into the panel now
}

/** Sign out: remove the shared credentials file so every surface (extension +
 *  MCP) disconnects. The env-var channel (HOVER_CLOUD_TOKEN) can't be cleared
 *  from here, so we say so when it's what's keeping the session alive. */
async function disconnectCloud(): Promise<void> {
  if (!readCloudCredentials()) {
    void vscode.window.showInformationMessage('Hover: not connected to Hover Cloud.');
    return;
  }
  const ok = await vscode.window.showWarningMessage(
    'Sign out of Hover Cloud? This removes the saved token from ~/.hover/credentials.json — the Hover MCP uses the same file.',
    { modal: true },
    'Sign out',
  );
  if (ok !== 'Sign out') return;
  try {
    rmSync(credentialsPath());
  } catch {
    /* already gone */
  }
  notified.clear();
  if (readCloudCredentials()) {
    void vscode.window.showWarningMessage(
      'Hover: still connected via the HOVER_CLOUD_TOKEN environment variable — unset it to fully sign out.',
    );
  } else {
    void vscode.window.showInformationMessage('Hover: signed out of Hover Cloud.');
  }
  void vscode.commands.executeCommand('hover.refreshDashboard');
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
