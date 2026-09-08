# ADR-0002: All external data access goes through a single server-only Provider Gateway

- **Status**: Proposed
- **Date**: 2026-09-08
- **Deciders**: architect (pending user approval)
- **Related**: [spec 0001](../specs/0001-portfolio-pulse-system-design.md),
  [ADR-0001](0001-tech-stack-nextjs-vercel-postgres.md), [ADR-0003](0003-precomputed-daily-briefing-snapshot.md),
  [ADR-0004](0004-manual-holding-adjustments.md)

---

## Context

The app integrates seven read-only data providers (KRX Open API, DART OpenAPI, Bank of Korea ECOS,
Finnhub, FMP, Naver Search) plus Google Gemini, using eight secrets already issued to the user. The
user's stated non-negotiable requirement is that **no external API key may ever be exposed to the
browser**.

The naive implementation of a data-driven app — a client component fetching a provider, or a thin
`/api/quote?symbol=` proxy that forwards browser requests to a provider — violates this in one of
two ways: either the key ships in the bundle, or the key doesn't ship but the *quota* becomes
publicly reachable, so anyone who finds the URL can drain a free tier that the user cannot
easily replenish.

Three further pressures point the same direction:

- **Free-tier quotas are the real scarce resource.** Uncontrolled call sites make quota consumption
  unpredictable and unattributable.
- **Six providers means six different response shapes, six error dialects, and six auth styles**
  (query-param keys for the Korean government APIs, header tokens elsewhere). Scattering that across
  the codebase guarantees inconsistent handling.
- **Query-string secrets leak into logs.** KRX/DART/ECOS style APIs put the key in the URL, so any
  naive request logging writes secrets to persistent storage.

## Decision

Route **every** outbound call to an external provider through one module,
`src/lib/providers/gateway.ts`, and forbid any other path.

The gateway owns, in order, for every call:

1. **Secret injection** — provider clients never read `process.env` themselves; they declare which
   env var names they require, and the gateway supplies them. A missing key fails fast at startup
   with the variable *name* (never a value) in the error.
2. **`import 'server-only'`** — placed at the top of the gateway and of `src/db/index.ts`. Any client
   component that transitively imports either one fails the **build**. The security property is
   compile-time, not runtime.
3. **Cache-first lookup** against the `provider_cache` table, keyed by a normalized request
   signature, with a per-provider TTL declared in the provider registry (see spec 0001 § Provider
   integration matrix). A cache hit performs no network call and consumes no quota.
4. **Rate limiting** — a conservative per-provider token bucket, sequential execution within a
   provider, defaulting to 1 request/second where the documented limit is unconfirmed.
5. **Zod validation** — every response is narrowed to the fields the app actually uses. Unvalidated
   provider JSON never propagates into the domain layer or into a page.
6. **Call logging** into `provider_call_log` with **query strings stripped**, so keys carried as URL
   parameters are never persisted.
7. **Normalized failure** — providers return a typed result, never a thrown vendor error. A single
   provider failing degrades the briefing (spec 0001 § Job sequence, step 3) instead of aborting it.

Corollary decisions that make the property hold:

- **There is no browser-callable data proxy.** Pages are Server Components reading Postgres. Because
  no route turns a browser request into a provider request, there is no endpoint to abuse and no
  quota to drain from outside.
- **No provider secret may ever carry the `NEXT_PUBLIC_` prefix**, which is the only mechanism by
  which Next.js inlines an env var into the client bundle. A build- or test-time assertion checks
  that no known secret name appears in client output.
- **Provider response bodies are never echoed verbatim to the client**, so an upstream error payload
  that happens to contain the request URL (key included) cannot surface in the UI.

## Consequences

**Positive**

- The security requirement becomes a build-time invariant with a single auditable choke point,
  rather than a rule that every future change must remember.
- Quota consumption is measurable (`provider_call_log`) and attributable per provider — which
  matters precisely because the real limits are currently unverified.
- Caching, retry, rate limiting, and validation are implemented once, not six times.
- Adding a provider is a registry entry plus a Zod schema; the security and quota behavior comes for
  free and cannot be accidentally opted out of.
- `security-monitor` review has one file to scrutinize closely instead of a diffuse surface.

**Negative / risks**

- **Indirection cost.** Every provider call passes through a layer, which is more machinery than a
  six-endpoint personal app strictly needs. Accepted: the alternative is the security property being
  re-established by hand at each call site.
- **The gateway becomes a single point of failure.** A bug there breaks all data ingestion at once.
  Mitigated by unit tests on cache/limiter/validation being non-negotiable in the acceptance criteria.
- **Postgres-as-cache is slower than a real cache** and adds write load. Irrelevant at this volume,
  and it avoids a second service and a ninth secret.
- **Conservative default rate limits will make the daily job slower than necessary** until real
  limits are confirmed and encoded. This is deliberate: burning a free-tier daily quota through
  optimistic assumptions is worse than a job that takes an extra minute at 07:00 KST while the user
  is asleep.
- Stale cache entries can silently mask a broken provider. Mitigated by surfacing per-provider
  last-success timestamps on the `/settings` health screen.

## Platform Impact

| Platform | Impact | Files Affected |
|----------|--------|----------------|
| Claude Code | **Changes required** — `.env.sample` documents the provider vars this gateway consumes and gains the new non-provider vars. The existing `.gitleaks.toml` already guards commits; no `CLAUDE.md` change is needed since this introduces no hook, command, or dispatch rule. | `.env.sample` |
| Antigravity (GEMINI.md) | **None — justified.** This is an application-architecture decision about runtime data flow, not AI-tooling behavior. `GEMINI.md` describes Antigravity's tool suite and subagent dispatch, none of which changes. The secret-handling rule that agents must follow ("never read or reproduce `.env` values") is already governed workspace-wide and is not Antigravity-specific. | N/A |
| templates/common | **None — this is a leaf project, not a workspace template.** No propagation path exists. The gateway pattern is generic enough to be worth extracting *if* this project is ever promoted via the `project-to-variant` skill; that is a decision for promotion time, not now. | N/A |

## Accessibility Impact

**No direct user-facing interaction is introduced** by this decision — it governs server-side data
flow only, which `docs/context.md` permits to be exempt when stated explicitly, as here.

One indirect and genuinely beneficial consequence: because pages read from Postgres rather than
awaiting provider calls, screens render immediately and deterministically with no loading
spinners, no layout shift, and no partially-populated content for a screen reader to announce
mid-update. The degraded-source state (a provider failed, so some data is stale) is surfaced as
explicit text and an icon on the affected screens — never by colour or by silently absent data —
which is a WCAG 1.4.1 and 3.3 concern handled in the UI spec.
