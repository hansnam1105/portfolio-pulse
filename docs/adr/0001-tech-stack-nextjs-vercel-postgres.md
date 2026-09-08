# ADR-0001: Next.js on Vercel with Neon Postgres as the portfolio-pulse stack

- **Status**: Proposed
- **Date**: 2026-09-08
- **Deciders**: architect (pending user approval)
- **Related**: [spec 0001](../specs/0001-portfolio-pulse-system-design.md),
  [ADR-0002](0002-server-side-provider-gateway.md), [ADR-0003](0003-precomputed-daily-briefing-snapshot.md),
  [ADR-0004](0004-manual-holding-adjustments.md)

---

## Context

portfolio-pulse had no tech stack: `docs/co-develop.context.md` shipped with a placeholder table
reading "Architect agent selects this in Phase 1-2". The stack must satisfy five constraints that
are unusual in combination:

1. **Secrets cannot reach the client.** Eight external API keys must be used exclusively
   server-side. This is stated by the user as non-negotiable, and it eliminates any static-site or
   client-only-SPA deployment outright — the app *must* have a trusted server runtime.
2. **The workload is one scheduled batch job per day** plus a handful of personal page views. There
   is no concurrency story, no multi-tenancy, no scale requirement.
3. **Budget-conscious, solo, personal.** Free tiers are the target. Equally important: *operational*
   cost. Any choice that makes the sole user responsible for patching a server, renewing a
   certificate, or babysitting a container is expensive in the currency that actually matters here.
4. **Money arithmetic must be exact.** Portfolio valuation in two currencies is reported to the user
   and acted upon; the workspace Computational Integrity standard forbids sloppy numerics.
5. **Mobile-first delivery**, read-heavy, with content that is fully known before the user opens the
   page.

The workspace standard is TypeScript executed via Bun (ADR-0036), which sets a strong prior toward a
TypeScript stack for anything the project's own agents will maintain.

## Decision

Adopt:

| Layer | Choice |
|-------|--------|
| Language | TypeScript 5+ (`strict`, `noUncheckedIndexedAccess`) |
| Framework | Next.js 15, App Router, React Server Components |
| Database | Neon Postgres (serverless), accessed via Drizzle ORM |
| Migrations | Drizzle Kit, SQL migrations committed to the repo |
| Validation | Zod at every external boundary (aligns with the `zod-contract-gate` skill) |
| Money | Postgres `numeric` + a decimal library in TS; no IEEE-754 arithmetic on money |
| Hosting | Vercel Hobby (free, personal non-commercial) |
| Scheduling | Vercel Cron calling a trigger-agnostic, token-guarded endpoint (see ADR-0003) |
| Package manager | Bun (workspace standard) |
| Testing | Bun test for unit/integration; Playwright reserved for later E2E |
| Styling | CSS custom properties generated from the existing `tokens.json` (Primitive → Semantic → Component) |

Rationale for the load-bearing choices:

- **Next.js App Router** is chosen primarily because React Server Components make the security
  requirement *structural*. Data access and provider calls execute on the server by default, and a
  client component that imports a secret-holding module fails the build rather than leaking at
  runtime. A framework where the default direction of data flow is server→client is worth more here
  than raw minimalism.
- **Neon Postgres** over SQLite-family options because money is the core data type. Postgres
  `numeric` gives exact decimal arithmetic in the database itself, and Neon's scale-to-zero free tier
  fits a database that is genuinely idle 23 hours a day. Serverless compute has an ephemeral
  filesystem, which rules out a local SQLite file regardless.
- **Drizzle over Prisma** because cold-start weight matters on serverless and the schema here is
  small and SQL-shaped; Drizzle's inference gives the type safety without the engine.
- **Vercel Hobby** because the entire operational burden becomes `git push`. Its known weakness —
  Hobby cron is coarse-grained and its trigger time is approximate — is mitigated in ADR-0003 by
  making the job endpoint trigger-agnostic rather than by choosing a different host.

Rejected: SvelteKit (smaller ecosystem for this problem shape), Hono + separate SPA (two deploy
units, two auth surfaces, more leak paths), Python/FastAPI (second language in a TypeScript
workspace), Turso/D1 (decimal handling for money), Supabase (auth product unused for one user),
self-hosted VPS (ongoing ops cost paid by the sole user), Upstash Redis (a second service and a
second secret for caching that Postgres handles fine at this volume).

## Consequences

**Positive**

- Secret containment is enforced by the framework's execution model plus `import 'server-only'`,
  not by developer discipline.
- One deploy unit, one auth surface, one place to look when something breaks.
- Exact decimal money end to end, satisfying the Computational Integrity standard.
- Expected recurring cost: zero, within free tiers, at this workload.
- Preview deployments per PR fit the existing `/sync` → PR workflow.

**Negative / risks**

- **Vendor coupling to Vercel** for cron and env-var management. Mitigated: the job endpoint is a
  plain HTTP POST guarded by a bearer token (ADR-0003), so migrating the scheduler — to GitHub
  Actions, or to another host entirely — is a configuration change, not a rewrite.
- **Neon cold starts.** The first query after idle is slow. Acceptable for a personal app; noticeable
  on the first morning page load.
- **Vercel Hobby terms permit personal, non-commercial use only.** This project qualifies as
  described, but the constraint is real and is raised as Open Question Q2 in the spec. Commercial
  use would require a paid plan.
- **Data residency**: portfolio data will sit on US/EU infrastructure. Called out for explicit user
  acknowledgement rather than assumed.
- App Router caching semantics are subtle; pages backed by user-specific data must opt out of static
  rendering deliberately, or a stale/foreign render becomes possible.
- Next.js has a faster major-version cadence than a solo project naturally keeps up with; expect
  periodic upgrade work.

**Follow-on obligations**

- `docs/co-develop.context.md` Tech Stack table must be filled in with this outcome — until then,
  every agent session starts with a placeholder and may re-derive a different stack.
- `.env.sample` gains `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`, `GEMINI_MODEL`, and the chosen
  auth vars. `.env` itself is never touched by agents.

  > **Cross-reference — amended by spec 0001 v3 (2026-09-08).** Application-level authentication was
  > removed from the design at the user's explicit direction, so `AUTH_SECRET` and the auth vars are
  > **not** added: `.env.sample` gains `DATABASE_URL`, `CRON_SECRET`, `GEMINI_MODEL` (plus optional
  > `TZ`, `BRIEFING_LANG`) only. The stack decision in this ADR is otherwise unaffected — Next.js on
  > Vercel with Neon Postgres was not chosen for its auth story. See spec 0001 § Authentication.

## Platform Impact

| Platform | Impact | Files Affected |
|----------|--------|----------------|
| Claude Code | **Changes required** — the placeholder Tech Stack table read at every session start must record this decision so code-writer and test-runner inherit the right stack. `CLAUDE.md` itself is unchanged: no new hook, command, agent, or dispatch rule. | `docs/co-develop.context.md`, `.env.sample` |
| Antigravity (GEMINI.md) | **None — justified.** `GEMINI.md` governs AI-tooling behavior (Antigravity tool mapping, `invoke_subagent` dispatch, hook parity). This decision adds no command, skill, agent, or dispatch change. The stack facts Antigravity needs live in the platform-neutral `docs/co-develop.context.md`, which is being updated, so Antigravity inherits the change without an edit. Copying stack facts into `GEMINI.md` would create a competing source of truth. | N/A |
| templates/common | **None — this is a leaf project, not a workspace template.** No propagation path exists from `Projects/portfolio-pulse` into `templates/common`. If the app is later promoted, propagation is decided by the `project-to-variant` skill at that point. | N/A |

## Accessibility Impact

Indirect but real. The stack choice supports the WCAG 2.1 AA target set in `docs/context.md`:
Server Components deliver semantic HTML that is meaningful before JavaScript executes (better for
screen readers and for a slow mobile connection), and styling is driven by the existing `tokens.json`
three-layer token architecture, whose light/dark semantic mappings are the place contrast ratios get
verified once rather than per component. No accessibility-relevant capability is foreclosed by this
decision. Concrete requirements are specified in spec 0001 § Accessibility and belong to the UI spec.
