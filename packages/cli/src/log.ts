// Minimal ANSI color + symbol helpers. We avoid pulling in chalk / picocolors
// to keep the CLI dependency surface tight (faster npx cold-start). Falls
// back to plain text if the output stream isn't a TTY (e.g. CI piping into
// a log file) so we don't dump escape codes into logs.
const isTTY = process.stdout.isTTY === true;
const wrap = (code: string, s: string): string => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);

export const dim = (s: string): string => wrap('2', s);
export const bold = (s: string): string => wrap('1', s);
export const green = (s: string): string => wrap('32', s);
export const yellow = (s: string): string => wrap('33', s);
export const red = (s: string): string => wrap('31', s);
export const blue = (s: string): string => wrap('34', s);
export const cyan = (s: string): string => wrap('36', s);

// Status symbols mirror what tools like Vite / Astro / shadcn use.
const SYM = {
  info: blue('ℹ'),
  ok: green('✓'),
  warn: yellow('⚠'),
  err: red('✗'),
  spark: cyan('✨'),
};

export const info = (msg: string): void => console.log(`${SYM.info} ${msg}`);
export const ok = (msg: string): void => console.log(`${SYM.ok} ${msg}`);
export const warn = (msg: string): void => console.log(`${SYM.warn} ${msg}`);
export const err = (msg: string): void => console.error(`${SYM.err} ${msg}`);
export const spark = (msg: string): void => console.log(`${SYM.spark} ${msg}`);
