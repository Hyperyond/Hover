import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, type HoverView } from "./App";
import { maybeSeedDevThread } from "./views/chat/devMock";
// Chat's stylesheet (also carries the shared base/theme resets). View-specific
// stylesheets are imported by their own view as later stages add them.
import "./views/chat/chat.css";

// The extension injects which screen to render (window.__HOVER_VIEW__). In the
// Vite dev server there's no host, so default to chat (devMock seeds it).
const view = ((window as { __HOVER_VIEW__?: string }).__HOVER_VIEW__ ?? "chat") as HoverView;

if (view === "chat") maybeSeedDevThread();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App view={view} />
  </StrictMode>,
);
