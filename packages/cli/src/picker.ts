/**
 * Tiny interactive single-select for the CLI. Native readline + ANSI;
 * no dependency added (CLI's npx cold-start budget is the binding
 * constraint — even small picker libs pull in 30+ modules and add
 * 200-500ms to first-run latency).
 *
 * Returns the chosen item, or null when the user cancels (Ctrl-C, Esc, q)
 * OR when stdin / stdout isn't a TTY (CI, piped invocations). The caller
 * is responsible for falling back to non-interactive behaviour in those
 * cases — typically printing the candidate list and exiting non-zero so
 * the user re-runs with an explicit flag.
 *
 * Up / Down (or k / j) to move, Enter to confirm, Esc / q / Ctrl-C to cancel.
 */

import { createInterface, emitKeypressEvents } from 'node:readline';

export interface PickerItem<T> {
  /** Bold first line. */
  label: string;
  /** Dimmed second line, optional. */
  detail?: string;
  /** Returned to the caller on selection. */
  value: T;
}

export interface PickerOptions<T> {
  title: string;
  items: PickerItem<T>[];
  /** Index of the item highlighted on first paint. Default 0. */
  initialIndex?: number;
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

const CSI = '\x1b[';
const HIDE = `${CSI}?25l`;
const SHOW = `${CSI}?25h`;
const CLEAR_LINE = `${CSI}2K`;
const UP = (n: number): string => (n > 0 ? `${CSI}${n}A` : '');

export async function pick<T>(opts: PickerOptions<T>): Promise<T | null> {
  if (!isInteractive()) return null;
  if (opts.items.length === 0) return null;

  let index = Math.max(0, Math.min(opts.items.length - 1, opts.initialIndex ?? 0));
  const out = process.stdout;

  // Manage raw mode + keypress events directly. createInterface wires
  // the stdin emitter for us; we add a 'keypress' listener that
  // emitKeypressEvents installs.
  const rl = createInterface({ input: process.stdin, escapeCodeTimeout: 50 });
  emitKeypressEvents(process.stdin, rl);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode?.(true);
  out.write(HIDE);

  let painted = 0;
  const render = (): void => {
    // Move cursor up to the start of the previous frame, clear those lines.
    if (painted > 0) {
      out.write(UP(painted));
      for (let i = 0; i < painted; i++) out.write(`${CLEAR_LINE}\n`);
      out.write(UP(painted));
    }
    const lines: string[] = [];
    lines.push(`\x1b[1m${opts.title}\x1b[0m`);
    lines.push(`\x1b[2m  ↑/↓ to move · Enter to select · Esc to cancel\x1b[0m`);
    for (let i = 0; i < opts.items.length; i++) {
      const it = opts.items[i];
      const cursor = i === index ? '\x1b[36m›\x1b[0m' : ' ';
      const label = i === index ? `\x1b[1m\x1b[36m${it.label}\x1b[0m` : it.label;
      lines.push(`${cursor} ${label}`);
      if (it.detail) {
        lines.push(`  \x1b[2m${it.detail}\x1b[0m`);
      }
    }
    const frame = lines.join('\n') + '\n';
    out.write(frame);
    painted = lines.length;
  };

  return new Promise<T | null>(resolveDone => {
    const cleanup = (): void => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode?.(wasRaw ?? false);
      out.write(SHOW);
      rl.close();
    };
    const finish = (value: T | null): void => {
      cleanup();
      resolveDone(value);
    };
    const onKey = (
      _str: string | undefined,
      key: { name?: string; ctrl?: boolean; sequence?: string },
    ): void => {
      if (!key) return;
      // Ctrl-C, Esc, q → cancel.
      if ((key.ctrl && key.name === 'c') || key.name === 'escape' || key.name === 'q') {
        finish(null);
        return;
      }
      if (key.name === 'up' || key.name === 'k') {
        index = (index - 1 + opts.items.length) % opts.items.length;
        render();
        return;
      }
      if (key.name === 'down' || key.name === 'j') {
        index = (index + 1) % opts.items.length;
        render();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish(opts.items[index].value);
        return;
      }
    };
    process.stdin.on('keypress', onKey);
    render();
  });
}
