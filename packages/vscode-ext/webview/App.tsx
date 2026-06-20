import { Chat } from "./views/chat/Chat";
import { Settings } from "./views/settings/Settings";
import { Dashboard } from "./views/dashboard/Dashboard";
import { Conversations } from "./views/conversations/Conversations";
import { Traffic } from "./views/traffic/Traffic";

/**
 * Top-level view router. Every Hover WebviewView loads the SAME bundle; the
 * extension injects which screen to render via `window.__HOVER_VIEW__` (see
 * src/webviewHost.ts). This is a param-driven switch, NOT react-router — each
 * webview is a separate sandboxed iframe with no shared URL/history, so there
 * is nothing for URL-based routing to route. Adding a view = one folder under
 * views/ + one case here.
 */
export type HoverView = "chat" | "settings" | "dashboard" | "conversations" | "traffic";

export function App({ view }: { view: HoverView }) {
  switch (view) {
    case "chat":
      return <Chat />;
    case "settings":
      return <Settings />;
    case "dashboard":
      return <Dashboard />;
    case "conversations":
      return <Conversations />;
    case "traffic":
      return <Traffic />;
    default:
      return <Chat />;
  }
}
