# ADR-0005: Single-user Google OAuth, not a user system

- **Status**: Accepted
- **Date**: 2026-09-08
- **Deciders**: user (approved this session)
- **Related**: [spec 0001](../specs/0001-portfolio-pulse-system-design.md),
  [ADR-0001](0001-tech-stack-nextjs-vercel-postgres.md),
  [ADR-0006](0006-self-hosted-oracle-cloud-deployment.md)

---

## Context

Spec 0001 v3 removed application-level auth entirely (cross-referenced in ADR-0001 and ADR-0004): the
app was reachable by anyone who found the URL, with only the daily-briefing job endpoint guarded by a
bearer token. That was an acceptable risk while the app lived at an obscure Vercel URL. It stops being
acceptable now that the app is moving to a stable, publicly resolvable domain
(`portfolio-pulse.duckdns.org`, ADR-0006) specifically so it's reachable from a phone anywhere — a
memorable, permanent address is also a more attractive target. The user asked for exactly one thing:
lock the app to their own Google account. Not a login system, not an invite flow, not multi-tenancy —
there is, and is expected to remain, exactly one legitimate user.

## Decision

Add Google sign-in via **Auth.js v5** (`next-auth@beta`), with a `signIn` callback that accepts exactly
one email address (`ALLOWED_GOOGLE_EMAIL`) and rejects every other Google account. No user table, no
roles, no invite mechanism.

- **JWT sessions, no database adapter.** `src/db/schema.ts` has zero auth-related tables today
  (`security`, `holding`, `manual_transaction`, `briefing`, etc. — all portfolio/market-data domain
  objects). Introducing a `DrizzleAdapter` and `user`/`session`/`account` tables to support exactly one
  hardcoded user would be pure overhead: a migration, three new tables, and a foreign key surface with
  nothing on the other end. A signed JWT cookie is the entire session mechanism.
- **Allowlist of size one, fail-closed.** `src/auth.ts`'s `signIn` callback returns `false` unless
  `profile.email === process.env.ALLOWED_GOOGLE_EMAIL`, and returns `false` (denies everyone) if that
  env var is unset — the same fail-closed rule `daily-briefing/route.ts` already applies to
  `CRON_SECRET`. An unconfigured secret must never silently mean "no auth required."
- **`middleware.ts` protects every route except three deliberate carve-outs**: `/api/auth/*` (Auth.js's
  own routes, or nothing can ever log in), `/api/jobs/*` (already guarded by its own bearer-token check
  — the cron caller has no browser session and a login redirect would break it), and `/api/health`
  (documented as deliberately secret-free).
- **Sign-in page:** the implementation uses `/login` (`src/app/login/page.tsx`),
  configured in `src/auth.ts`. This supersedes the original built-in-page-only
  decision; the login route remains reachable without a session.
- **Sign-out lives in `TabBar`**, the app's one piece of persistent global chrome, as a 5th control
  styled identically to the four nav tabs — not a new header (each screen already renders its own
  per-page `.appbar`; hoisting a shared header just for this would be new structure for one button).

## Consequences

**Positive**

- Closes the "anyone who finds the URL" exposure now that the URL is a stable, guessable-ish domain.
- Zero new database surface — no migration, no adapter, no tables to keep in sync with a schema that
  otherwise has nothing to do with authentication.
- The existing `CRON_SECRET` bearer-token pattern for the one machine-to-machine endpoint is untouched;
  session auth and secret-token auth cleanly cover disjoint call paths.

**Negative / risks**

- **Single point of failure on one Google account.** If that account is locked out or its password
  compromised, there's no secondary access path or admin override — accepted, because a second path
  would itself be a second attack surface for an app with exactly one intended user.
- **Google's consent screen stays in "Testing" mode** (ADR-0006 §Setup) rather than being verified —
  fine for one test user, but means Google could in principle expire test-user grants; re-consenting is
  a two-click recovery, not a hard failure.
- Adding a second legitimate user later (not currently planned) means revisiting the single-email
  allowlist design, not just editing a config value — this ADR deliberately does not build toward that.

## Platform Impact

| Platform | Impact | Files Affected |
|----------|--------|----------------|
| Claude Code | **No governance change.** Adds an application dependency and env vars; no new hook, command, agent, or dispatch rule. | `.env.sample` |
| Antigravity (GEMINI.md) | **None — justified.** Same reasoning as ADR-0001/0004: this is an application-level decision read from the shared, platform-neutral docs, not an AI-tooling behavior change. | N/A |
| templates/common | **None** — leaf project, no propagation path. | N/A |

## Accessibility Impact

**Direct** — adds the app's first authentication UI.

- The sign-out control reuses `TabBar`'s existing `<nav>`/`<button>` semantics, ≥44px target, and
  `:focus-visible` outline — no new interaction pattern to validate.
- Auth.js's built-in sign-in page is a third-party surface; not audited here. If it proves inaccessible
  in practice, a minimal custom sign-in page reusing `.btn--primary` becomes in-scope follow-up work.
- The middleware redirect-on-unauthenticated preserves the original destination via the OAuth `state`
  round-trip, so a keyboard/screen-reader user returns to the page they asked for, not always the home
  screen.
