/**
 * The minimal captured-request shapes the probe engine reasons about.
 *
 * A richer captured-flow type (e.g. `@hover-dev/security`'s `Flow`) is
 * structurally compatible — it simply carries extra fields — so consumers pass
 * their own flows without any adapter. The engine deliberately owns these
 * minimal types so it has ZERO dependency on any consumer package.
 */
export interface ProbeRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  /** Body as UTF-8 text if it decoded; null if binary or empty. */
  bodyText: string | null;
}

export interface ProbeFlow {
  request: ProbeRequest;
}
