import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Single source of truth: the same stylesheet the legacy webview inlines.
import "../src/chatView.css";
import { App } from "./App";
import { maybeSeedDevThread } from "./devMock";

maybeSeedDevThread();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
