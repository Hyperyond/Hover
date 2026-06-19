import { post } from "./vscode";

/** Top bar: new-session, the current conversation label, and the app-status pill.
 *  Wires to existing extension commands (the session-switcher popup comes later). */
export function Header({
  sessionLabel,
  appOnline,
  appLabel,
}: {
  sessionLabel: string;
  appOnline: boolean;
  appLabel: string;
}) {
  return (
    <header>
      <button className="iconbtn" title="New session" onClick={() => post({ type: "command", id: "hover.newSession" })}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </button>
      <button className="barebtn" id="session" title="Conversations" onClick={() => post({ type: "command", id: "hover.newSession" })}>
        <span id="session-label">{sessionLabel}</span>
      </button>
      <span className="spacer" />
      <button className="appstatus" title="App URL — click to set / start" onClick={() => post({ type: "command", id: "hover.appStatus" })}>
        <span className={appOnline ? "dot" : "dot offline"} />
        <span>{appLabel ? (appOnline ? appLabel : `${appLabel} (offline)`) : "detecting…"}</span>
      </button>
    </header>
  );
}
