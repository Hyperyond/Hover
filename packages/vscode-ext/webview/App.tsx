import { Home } from "./views/home/Home";
import { BusinessMap } from "./views/business-map/BusinessMap";

/**
 * Top-level view router. Every Hover WebviewView loads the SAME bundle; the
 * extension injects which screen to render via `window.__HOVER_VIEW__` (see
 * src/webviewHost.ts). This is a param-driven switch, NOT react-router — each
 * webview is a separate sandboxed iframe with no shared URL/history.
 *
 * `home` is the single sidebar panel (tabs: Overview / Heal / Env / Map);
 * `business-map` is the full-graph editor panel that the Map tab opens.
 */
export type HoverView = "home" | "business-map";

export function App({ view }: { view: HoverView }) {
  switch (view) {
    case "business-map":
      return <BusinessMap />;
    case "home":
    default:
      return <Home />;
  }
}
