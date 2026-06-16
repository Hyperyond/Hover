/**
 * The path fence for the opt-in `read_source` capability (codeContext).
 *
 * Giving the agent the ability to read source is the ONE place Hover relaxes
 * its "the agent only touches the browser" rule, so the fence is the whole
 * security story. It must guarantee, on every call, that a caller-supplied path:
 *   1. resolves to a location INSIDE the project root (no `..` / absolute-path
 *      escape — symlink escape is caught by the server's realpath re-check), and
 *   2. is not a credential / secret / VCS / dependency file.
 * Pure + lexical so it's exhaustively unit-testable; the server layers a
 * realpath check + a size/binary guard on top.
 */
import { resolve, relative, isAbsolute, sep } from 'node:path';

/** Files we refuse to read even inside the root — credentials, keys, VCS,
 *  dependency trees, build caches. Matched against the POSIX-style relative
 *  path (so `\` on Windows is normalised first). */
const SECRET_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.[^/]*)?$/i, //              .env, .env.local, .env.production
  /\.env$/i, //                             any *.env dotenv file (prod.env, local.env)
  /(^|\/)\.envrc$/i, //                      direnv (holds exported env / secrets)
  /\.tfvars(\.json)?$/i, //                  terraform variable files (often secrets)
  /(^|\/)\.htpasswd$/i, //                   http basic-auth credentials
  /(^|\/)\.git(\/|$)/, //                    the git dir
  /(^|\/)node_modules(\/|$)/, //             dependency tree
  /(^|\/)\.(next|nuxt|svelte-kit|astro|turbo|cache|output|vercel)(\/|$)/, // build caches
  /(^|\/)(dist|build|coverage)(\/|$)/, //    build output
  /\.(pem|key|p12|pfx|crt|cer|der|keystore|jks)$/i, // key / cert material
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.[^/]*)?$/i, // ssh keys
  /(^|\/)\.(npmrc|netrc|pgpass)$/i, //       token-bearing rc files
  /(^|\/)\.(ssh|aws|gnupg|gcloud|kube|docker)(\/|$)/i, // credential dirs
  /(^|\/)secrets?(\/|\.[^/]*$|$)/i, //       a secrets dir, or a secret(s).<ext> file
  /(^|\/)credentials?(\/|\.[^/]*$|$)/i, //   a credentials dir, or credential(s).<ext>
  /\.(secret|secrets)$/i,
];

export interface FenceOk {
  ok: true;
  /** Absolute, root-anchored path the server may stat/read (after realpath). */
  abs: string;
  /** POSIX-style path relative to the root — safe to echo back to the agent. */
  rel: string;
}
export interface FenceErr {
  ok: false;
  reason: string;
}

/** A path containing a NUL or C0 control char is never a legitimate source file. */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

/**
 * Resolve `input` against `root`, refusing anything outside the root or matching
 * a secret pattern. `input` is treated as relative to the root; an absolute
 * input is resolved too but will fail the containment check unless it happens to
 * live under the root (the agent should pass repo-relative paths).
 */
export function resolveSourcePath(root: string, input: string): FenceOk | FenceErr {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, reason: 'path is required' };
  }
  if (hasControlChar(input)) {
    return { ok: false, reason: 'path contains control characters' };
  }
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, input);
  const rel = relative(rootAbs, abs);
  // Outside the root: relative() returns '' for the root itself, a '..'-prefixed
  // path for an ancestor/sibling, or an absolute path when on a different drive.
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || rel.startsWith('../') || isAbsolute(rel)) {
    return { ok: false, reason: 'path escapes the project root' };
  }
  const relPosix = rel.split(sep).join('/');
  for (const pat of SECRET_PATTERNS) {
    if (pat.test(relPosix)) {
      return { ok: false, reason: `refused: "${relPosix}" matches an excluded (secret / build / VCS) pattern` };
    }
  }
  return { ok: true, abs, rel: relPosix };
}

/** True if a resolved-and-realpathed absolute path is still inside the root.
 *  The server calls this AFTER realpath to defeat symlink escape (a symlink
 *  whose lexical path passed resolveSourcePath but points outside the root). */
export function isWithinRoot(root: string, realAbs: string): boolean {
  const rootAbs = resolve(root);
  const rel = relative(rootAbs, realAbs);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !rel.startsWith('../') && !isAbsolute(rel);
}
