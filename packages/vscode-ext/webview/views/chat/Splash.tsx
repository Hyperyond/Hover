import { post } from "../../shared/vscode";

const CHIPS = ["Test the login flow", "Add an item to the cart", "Find broken access control"];

/** Empty-state splash. Clicking a chip prefills the composer (via onPick). */
export function Splash({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="splash">
      <div className="splash-hero">
        <div className="splash-mark">
          <span className="splash-halo" />
          <svg width="68" height="68" viewBox="0 0 100 100" aria-label="Hover">
            <defs>
              <linearGradient id="hvsg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#c6ffdd" />
                <stop offset="100%" stopColor="#5ef29a" />
              </linearGradient>
            </defs>
            <path
              d="M50 3 C54.5 31, 69 45.5, 97 50 C69 54.5, 54.5 69, 50 97 C45.5 69, 31 54.5, 3 50 C31 45.5, 45.5 31, 50 3 Z"
              fill="url(#hvsg)"
            />
          </svg>
        </div>
        <div className="splash-name rise d1">Hover</div>
        <div className="splash-tag rise d2">AI tests your app and writes a real Playwright spec.</div>
        <div className="splash-chips">
          {CHIPS.map((text, i) => (
            <button key={text} className={`splash-chip rise d${i + 3}`} onClick={() => onPick(text)}>
              {text}
              <span className="ar">→</span>
            </button>
          ))}
        </div>
        <button className="startapp rise d6" onClick={() => post({ type: "command", id: "hover.startApp" })}>
          ▶ Start App
        </button>
      </div>
      <a className="splash-link" onClick={() => post({ type: "command", id: "hover.openSite" })}>
        Visit gethover.dev ↗
      </a>
    </div>
  );
}
