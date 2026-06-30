import { Dashboard } from "./views/dashboard/Dashboard";
import { BusinessMap } from "./views/business-map/BusinessMap";

/**
 * Top-level view router. Every Hover WebviewView loads the SAME bundle; the
 * extension injects which screen to render via `window.__HOVER_VIEW__` (see
 * src/webviewHost.ts). This is a param-driven switch, NOT react-router — each
 * webview is a separate sandboxed iframe with no shared URL/history, so there
 * is nothing for URL-based routing to route. Adding a view = one folder under
 * views/ + one case here.
 */
export type HoverView = "dashboard" | "business-map";

export function App({ view }: { view: HoverView }) {
  switch (view) {
    case "business-map":
      return <BusinessMap />;
    case "dashboard":
    default:
      return <Dashboard />;
  }
}
