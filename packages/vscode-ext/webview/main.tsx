import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, type HoverView } from "./App";
import { maybeSeedDevThread } from "./views/chat/devMock";
// Shared base: Tailwind + theme tokens. The other views are styled with Tailwind
// utilities; the chat view keeps a dedicated stylesheet (rail pseudo-elements,
// run-indicator/splash keyframes, body-state cascades) that reuses theme tokens.
import "./theme.css";
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
