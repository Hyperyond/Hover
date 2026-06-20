/**
 * The Hover "Network" view — captured HTTP flows, live, in security / pentest
 * mode only.
 *
 * The security runtime's MITM proxy already captures every browser-reachable
 * request as a Flow and broadcasts `security:flow:added` / `security:flow:updated`
 * (and `security:flows:cleared` on reset) over the service WS. This view is a
 * thin presenter: the extension forwards those flows in, and the webview renders
 * a live list (method · URL · status · duration), click to expand request /
 * response detail. Empty (and hidden via the `hover.modeActive` context key) in
 * normal mode, where no proxy runs.
 *
 * This is the visible surface; the durable value is turning a flow into a
 * crystallized `.api-test.spec.ts` regression — that "Crystallize" action lands
 * on these rows next.
 */
import * as vscode from 'vscode';
import { renderWebviewHtml } from './webviewHost.js';

interface FlowReq { method?: string; url?: string; startedAt?: number; headers?: Record<string, string>; body?: string }
interface FlowRes { statusCode?: number; statusMessage?: string; completedAt?: number; headers?: Record<string, string>; body?: string }
export interface Flow { id: string; request?: FlowReq; response?: FlowRes; mutated?: boolean }

const MAX_FLOWS = 500;

export class TrafficViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.traffic';
  private view?: vscode.WebviewView;
  private flows: Flow[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'traffic');
    view.webview.onDidReceiveMessage((msg: { type: string }) => {
      if (msg.type === 'ready') this.pushAll();
    });
  }

  /** Add or update a flow (keyed by id), newest last; cap the buffer. */
  upsert(flow: Flow): void {
    if (!flow || !flow.id) return;
    const i = this.flows.findIndex((f) => f.id === flow.id);
    if (i >= 0) this.flows[i] = flow;
    else {
      this.flows.push(flow);
      if (this.flows.length > MAX_FLOWS) this.flows.shift();
    }
    void this.view?.webview.postMessage({ type: 'flow', flow });
  }

  clear(): void {
    this.flows = [];
    void this.view?.webview.postMessage({ type: 'clear' });
  }

  private pushAll(): void {
    void this.view?.webview.postMessage({ type: 'all', flows: this.flows });
  }

}

/** Register the Network view. The extension forwards flows in via the returned
 *  provider; returns it + disposables. */
export function registerTrafficView(extensionUri: vscode.Uri): { provider: TrafficViewProvider; disposables: vscode.Disposable[] } {
  const provider = new TrafficViewProvider(extensionUri);
  const view = vscode.window.registerWebviewViewProvider(TrafficViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  return { provider, disposables: [view] };
}
