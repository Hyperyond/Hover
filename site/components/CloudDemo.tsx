/* ── Hover Cloud (planned) preview ───────────────────────────────────────
 * A deliberately light mock of the planned hosted "watch" layer over the specs
 * you already own: a small monitoring / flakiness strip for the Acme Store
 * suite. Marked Planned — we don't over-invest in a feature that isn't shipped;
 * a simple, on-brand visual + the planned badge is enough. No 'use client' —
 * it's static markup, ships zero JS. */

type Bar = { day: string; ok: boolean };

// A two-week run history sparkline — mostly green with one flaky day, so it
// reads like real monitoring rather than a perfect demo.
const HISTORY: Bar[] = [
  { day: 'M', ok: true },
  { day: 'T', ok: true },
  { day: 'W', ok: true },
  { day: 'T', ok: true },
  { day: 'F', ok: false },
  { day: 'S', ok: true },
  { day: 'S', ok: true },
  { day: 'M', ok: true },
  { day: 'T', ok: true },
  { day: 'W', ok: true },
  { day: 'T', ok: true },
  { day: 'F', ok: true },
  { day: 'S', ok: true },
  { day: 'S', ok: true },
];

export function CloudDemo() {
  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-xl border border-dashed border-line bg-bg-3 font-mono text-[12.5px] text-text">
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2 text-text-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-text-dim" />
            Cloud · Acme Store
          </div>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-[10.5px] uppercase tracking-wider text-text-dim">
            Planned
          </span>
        </div>

        <div className="px-4 py-4">
          {/* Stat strip */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Scheduled runs" value="2× / day" />
            <Stat label="Pass rate (14d)" value="98.5%" mint />
            <Stat label="Flaky specs" value="1" warn />
          </div>

          {/* 14-day run history sparkline */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[11px] text-text-dim">
              <span>Run history · last 14 days</span>
              <span>scheduled monitoring</span>
            </div>
            <div className="flex items-end gap-1.5">
              {HISTORY.map((b, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <span
                    className="w-full rounded-sm"
                    style={{
                      height: b.ok ? 30 : 16,
                      background: b.ok ? 'rgba(124,255,168,0.55)' : 'var(--color-warn)',
                      opacity: b.ok ? 1 : 0.85,
                    }}
                  />
                  <span className="text-[9.5px] text-text-dim">{b.day}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[11px] text-text-dim">
          <span>parallel runs · self-heal on failure</span>
          <span>the artifact stays yours</span>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mint,
  warn,
}: {
  label: string;
  value: string;
  mint?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg-2 px-3 py-3">
      <div className="text-[10.5px] uppercase tracking-wider text-text-dim">{label}</div>
      <div
        className="mt-1.5 text-[18px] font-semibold tracking-tight"
        style={{
          color: mint ? 'var(--color-mint)' : warn ? 'var(--color-warn)' : 'var(--color-text)',
        }}
      >
        {value}
      </div>
    </div>
  );
}
