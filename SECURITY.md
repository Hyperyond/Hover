# Security Policy

This document covers two distinct things:

1. **How to report a vulnerability in Hover itself** — see *Reporting a vulnerability* below.
2. **Acceptable use of Hover's Security testing mode** — see *Acceptable use* below. This is important; please read it before running `@hover-dev/security` against any target.

---

## Reporting a vulnerability

Found a security issue in Hover (the project — the VS Code extension, the `@hover-dev/*` packages, or the documentation)?

**Email: <oliver@hyperyond.com>**

Please include:

- A clear description of the issue.
- A reproduction — minimal code or steps.
- The version(s) affected (the `hover-dev` extension version and/or `@hover-dev/core` version, and Node major).
- Your suggested severity (Critical / High / Medium / Low) and impact assessment.

What to expect:

- Acknowledgement within **3 working days**.
- A first-pass assessment within **7 days** of the initial report.
- For confirmed issues: a coordinated fix targeting the next patch release, with attribution in the release notes unless you ask to remain anonymous.

Please **do not** open public GitHub issues for security reports. GitHub Security Advisories (the private "Report a vulnerability" button on the repo's Security tab) is also a valid channel and routes to the same maintainer.

### Scope of this policy

In scope:

- The `hover-dev` VS Code extension, `@hover-dev/core`, `@hover-dev/security`, and `@hover-dev/pentest` — built from this repository.
- Documentation that, if followed, would create a security issue for the reader.

Out of scope:

- Issues in third-party packages we depend on (report those upstream — but if a transitive dep affects Hover's safe defaults, we want to know).
- Findings *produced by* Hover's Security testing mode running against your own application — those are findings in **your app**, not in Hover. Don't email those here.
- Findings produced by running Hover against systems you do not own or have written authorisation to test — those reports are not accepted, see the next section.

---

## Acceptable use — Security testing mode

Hover ships an optional plugin, `@hover-dev/security`, that turns the extension's chat into an aided security-testing tool. When the mode is active the agent gets MCP tools to inspect, replay, and mutate captured API calls on whichever browser session it's driving.

**You must only point this at systems you own, or systems you have explicit written authorisation to test.**

That includes:

- Your own dev server running on `localhost`.
- Staging / pre-production environments your employer owns and has authorised you to probe.
- Targets within a bug-bounty programme whose scope explicitly permits this style of testing.

Pointing Security mode at anything else — production systems you don't own, third-party services you happen to be a customer of, friends' projects without their consent — is, in most jurisdictions, a **criminal offence** (US: Computer Fraud and Abuse Act; UK: Computer Misuse Act 1990; EU: Directive 2013/40/EU; PRC: Cybersecurity Law Article 27 / Criminal Law Article 285–286; equivalent laws elsewhere).

The maintainers cannot grant you authorisation to test anything. Authorisation comes from the system's owner, in writing, before you start. If you are unsure whether you have it, you do not have it.

### What the project does to keep you on the right side of this

- The agent's system prompt (`SECURITY_SYSTEM_PROMPT` in `packages/security/src/index.ts`) is scoped to **browser-reachable** vulnerability classes only and explicitly forbids SQL injection, SSRF, RCE, fuzzing loops, and the kinds of probes that are harder to argue as defensive testing.
- The default debug Chrome lives in an isolated `<tmpdir>/hover-chrome-security` profile — you must log into a target separately, which surfaces the "is this really my system?" moment.
- The mode bar tints orange and the launcher rings orange when Security mode is active, so it's hard to forget you're in altered state.
- The crystallised Playwright specs save under `__vibe_tests__/` in your *own* repository — no central server, no telemetry, no upload.

These are guardrails, not guarantees. Final responsibility for what Hover does on your machine is yours.

### What the maintainers will not help with

We will refuse to assist with:

- Improving Hover's effectiveness against targets you don't have authorisation to test.
- Adding features whose primary purpose is to bypass authentication or rate-limits on third-party services.
- Removing the orange-engaged visual cues or the "authorised testing only" copy.

PRs to extend the scope of what Hover can probe in a *legitimate* direction (more authz checks, better compliance signals, broader header analysis) are welcome.

---

## Public disclosure timeline

Once a security fix lands in a tagged release, we'll publish a brief advisory describing the issue and crediting the reporter (unless they asked to remain anonymous). We avoid publishing reproduction details until users have had a reasonable window to upgrade — typically **14 days** after the fix release.

---

Maintainer contact: <oliver@hyperyond.com>
