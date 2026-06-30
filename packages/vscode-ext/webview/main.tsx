import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, type HoverView } from "./App";
// Shared base: Tailwind + theme tokens. The views are styled with Tailwind
// utilities over these theme tokens.
import "./theme.css";

// The extension injects which screen to render (window.__HOVER_VIEW__). In the
// Vite dev server there's no host, so default to the dashboard.
const view = ((window as { __HOVER_VIEW__?: string }).__HOVER_VIEW__ ?? "dashboard") as HoverView;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App view={view} />
  </StrictMode>,
);
