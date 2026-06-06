// Minimal ANSI color + Clack-style line helpers. We avoid pulling in chalk /
// picocolors to keep the CLI dependency surface tight (faster npx cold-start).
// Colors fall back to plain text off a TTY (e.g. CI piping into a log file) so
// we don't dump escape codes into logs; the connector glyphs are plain Unicode
// and print everywhere.
const isTTY = process.stdout.isTTY === true;
const wrap = (code: string, s: string): string => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);

export const dim = (s: string): string => wrap('2', s);
export const bold = (s: string): string => wrap('1', s);
export const green = (s: string): string => wrap('32', s);
export const yellow = (s: string): string => wrap('33', s);
export const red = (s: string): string => wrap('31', s);
export const blue = (s: string): string => wrap('34', s);
export const cyan = (s: string): string => wrap('36', s);

// ── Clack/Claude-style vertical-connector frame ────────────────────────────
// Every hover command renders the same shape so `setup`, `run`, `optimize`,
// `extract`, and `re-record` look like one tool:
//
//   ◇ <title>            head()  — opens a flow
//   │  <text>            line() / info()
//   │  ✓ <text>          ok()
//   │  ⚠ <text>          warn()
//   │    <dim text>      sub()   — a nested detail
//   │                    gap()   — breathing room
//   ◆ <result>           done()  — marks the outcome
//   ╰─ <hint>            tail()  — the closing next-step line
//
// Errors are the exception: `err()` prints a standalone `✗` to stderr (no bar)
// because a failure can fire during pre-flight, before any head() opens a flow.
const BAR = dim('│');

export const head = (label: string): void => console.log(`${cyan('◇')} ${label}`);
export const line = (text: string): void => console.log(`${BAR}  ${text}`);
export const sub = (text: string): void => console.log(`${BAR}    ${dim(text)}`);
export const gap = (): void => console.log(BAR);
export const done = (label: string): void => console.log(`${cyan('◆')} ${label}`);
export const tail = (text: string): void => console.log(`${dim('╰─')} ${text}`);

// Status lines that live on the bar (used mid-flow, after a head()).
export const info = (msg: string): void => console.log(`${BAR}  ${msg}`);
export const ok = (msg: string): void => console.log(`${BAR}  ${green('✓')} ${msg}`);
export const warn = (msg: string): void => console.log(`${BAR}  ${yellow('⚠')} ${msg}`);
export const err = (msg: string): void => console.error(`${red('✗')} ${msg}`);
