# ADR-0003: The daily briefing is a precomputed, persisted snapshot, not an on-demand generation

- **Status**: Proposed
- **Date**: 2026-09-08
- **Deciders**: architect (pending user approval)
- **Related**: [spec 0001](../specs/0001-portfolio-pulse-system-design.md),
  [ADR-0001](0001-tech-stack-nextjs-vercel-postgres.md), [ADR-0002](0002-server-side-provider-gateway.md),
  [ADR-0004](0004-manual-holding-adjustments.md) — refines this ADR's holdings source: the job reads
  its security list from the `current_holding` view (latest snapshot ⊕ later manual transactions)
  rather than directly from the latest snapshot. The decision recorded below is otherwise unchanged.

---

## Context

The product's core feature is a daily briefing: news and macro data relevant to the user's actual
holdings, analyzed by an LLM and presented as a morning summary. The obvious implementation is to
generate it when the user opens the app. That is wrong here for four reasons:

1. **Cost.** Gemini is being used on the free tier explicitly for budget reasons (it replaced
   Anthropic in the source plan on cost grounds). Generating on page view makes LLM spend a function
   of how often the user refreshes — unbounded, and a nervous investor refreshes a lot.
2. **Quota.** The same applies upstream: on-demand generation means each page view fans out to six
   providers, so the free-tier quotas that actually constrain this project get consumed by browsing.
3. **Latency.** A mobile user opening the app at 07:00 KST should not wait on a six-provider fan-out
   plus an LLM round trip. The content they want was fully determined hours earlier.
4. **Reproducibility.** A briefing the user read at breakfast and wants to re-read at lunch should be
   the *same* briefing. Regenerating produces different prose from a nondeterministic model, which is
   confusing at best and, for something the user may act on financially, misleading at worst.

There is also a scheduling constraint from ADR-0001: Vercel's Hobby tier offers cron but at coarse
granularity with an approximate trigger time, and it is a vendor-specific mechanism.

## Decision

**Generate the briefing once per calendar day in a scheduled batch job; persist it; serve it as a
static database read.**

- A `briefing` row is keyed by `briefing_date` (unique) with per-holding `briefing_item` children.
  Every page view is a read of that row. **Zero outbound provider calls occur on any page view** —
  this is an explicit acceptance criterion, asserted by checking `provider_call_log` is unchanged
  across a page-load test.
- **The trigger is decoupled from the scheduler.** The job is a plain
  `POST /api/jobs/daily-briefing`, authorized by either an `Authorization: Bearer $CRON_SECRET`
  header or an authenticated user session. Vercel Cron is the default caller; GitHub Actions, any
  other scheduler, or the "regenerate" button in `/settings` work identically. This turns ADR-0001's
  coarse-cron weakness and its vendor coupling into a configuration detail.

  > **Cross-reference — narrowed by spec 0001 v3 (2026-09-08).** Application-level authentication was
  > removed from the design at the user's explicit direction, so the "or an authenticated user
  > session" alternative above no longer exists. The endpoint is guarded by the `CRON_SECRET` bearer
  > token **only**, and `/settings`' "regenerate" button is a Server Action that calls the job
  > directly rather than an authenticated HTTP call. This decision itself is unchanged: the trigger
  > stays decoupled from the scheduler, and `CRON_SECRET` remains required. See spec 0001
  > § Authentication.
- **Idempotency has two layers.** A `job_run` row unique on `(job_name, run_date)` prevents
  concurrent double execution. An `input_digest` — a hash of the assembled prompt inputs — means a
  rerun whose inputs are unchanged short-circuits *before* the LLM call. Re-running the job is
  therefore always safe and usually free.
- **Exactly one Gemini call per day**, batched: all holdings, their news, and the macro context go
  into a single structured-output request, rather than one call per position. Cost and latency stay
  flat as the portfolio grows, up to the point where context limits force chunking (a documented
  fallback, not the default path).
- **Graceful degradation.** A failure in any single non-Gemini provider does not abort the job. The
  briefing is written with `status='partial'` and the failed provider recorded in `degraded_sources`,
  which the UI surfaces as explicit text plus an icon. A briefing missing Naver news is far more
  useful than no briefing.
- **The model never computes or restates numbers.** Pre-computed figures are supplied as data with an
  instruction to reference them verbatim, and the structured-output schema contains no free numeric
  fields. Every number rendered in the UI comes from a database column, not from model prose. This
  is required by the workspace Computational Integrity standard and is the single most important
  guardrail in the design, since the model is generating text about money.
- **The briefing describes and contextualizes; it does not advise.** The prompt carries that
  instruction explicitly and the UI carries a plain disclaimer.
- Recommended trigger: **07:00 KST (22:00 UTC)** — after both the prior US session and the prior KRX
  session have closed.

## Consequences

**Positive**

- LLM and provider cost is bounded and predictable: one Gemini call and one bounded fan-out per day,
  regardless of user behavior.
- Instant page loads on mobile; no spinner, no layout shift, no dependence on provider uptime at read
  time.
- The briefing is stable and re-readable, and every past day's briefing is retained — a history the
  on-demand design could never produce.
- Failures happen at 07:00 while the user is asleep, not in front of them, and are visible in the
  `/settings` health view.
- Reproducible: `model`, `prompt_version`, and `input_digest` are stored with each briefing, so odd
  output can be diagnosed after the fact.

**Negative / risks**

- **Content can be up to 24 hours stale.** Breaking news mid-day will not appear until tomorrow's
  briefing. Mitigated by the manual "regenerate" control; accepted as inherent to a *daily* briefing
  product.
- **Free-tier cron timing is approximate**, so the briefing may not be ready at a precise hour.
  Mitigated by scheduling early and by the trigger-agnostic endpoint (GitHub Actions gives precise
  timing if the imprecision proves annoying).
- **A single missed run leaves a gap** with no automatic backfill in v1. The job is date-keyed and
  idempotent, so a manual re-trigger fixes it; automatic catch-up is deliberately deferred.
- **`CRON_SECRET` is a new secret** and a new thing to rotate. Accepted: the endpoint must not be
  publicly triggerable, or anyone could burn the daily Gemini quota.
- **LLM output about financial holdings carries hallucination risk.** Partially mitigated by
  structured output, by citations constrained to `cited_news_ids` drawn from the news actually fed to
  the model, and by the no-numbers rule — but not eliminated. The disclaimer and the
  describe-don't-advise instruction are load-bearing, not decorative.
- Prompt changes make historical briefings non-comparable; `prompt_version` records which prompt
  produced each one.

## Platform Impact

| Platform | Impact | Files Affected |
|----------|--------|----------------|
| Claude Code | **Changes required** — `.env.sample` gains `CRON_SECRET` and `GEMINI_MODEL`, and the model id is read from env rather than hardcoded so it can be changed without a code edit. No `CLAUDE.md` change: no new hook, slash command, agent, or dispatch rule. | `.env.sample`, `vercel.json` |
| Antigravity (GEMINI.md) | **None — justified.** This decision concerns the *application's* runtime use of the Gemini API as a data provider. It does not touch Antigravity's own model tiers, `invoke_subagent` dispatch, tool suite, or hook parity, which is what `GEMINI.md` governs. The name collision between "the app calls Gemini" and "Gemini CLI runs agents" is coincidental — they are unrelated concerns, and conflating them in `GEMINI.md` would actively mislead a future session. | N/A |
| templates/common | **None — this is a leaf project, not a workspace template.** No propagation path exists from `Projects/portfolio-pulse` into `templates/common`. | N/A |

## Accessibility Impact

**Direct, and positive.** The briefing is the app's primary user-facing content, so this decision
shapes how it is perceived:

- Because content is fully materialized before the page is requested, the briefing renders as
  complete, correctly-ordered semantic HTML in one pass. There is no progressive fill, no content
  arriving after a screen reader has begun reading, and no layout shift — all of which are concrete
  WCAG 2.1 problems that on-demand generation would have introduced.
- The briefing mixes Korean and English sources. Each rendered passage must carry the correct `lang`
  attribute (`lang="ko"` / `lang="en"`) so screen readers switch pronunciation; the storage model
  supports this because `news_item.lang` is captured at ingest.
- The **degraded/partial** state must be conveyed as text plus an icon, never by colour or by content
  silently missing — a user must be able to tell "there is no Korean news today" apart from "the
  Korean news source failed".
- Sentiment (`positive`/`neutral`/`negative`/`unclear`) must likewise never be colour-only; it needs
  a text label or icon in its accessible name. The `unclear` value exists specifically so the model
  is not forced into a false binary.
- Long-form briefing text requires correct heading hierarchy per holding so a screen-reader user can
  skip between positions rather than reading linearly.

Verification is via the `accessibility-audit` skill (axe-core, WCAG 2.1 AA) against the briefing
screen, plus a manual screen-reader pass on a mixed Korean/English briefing.
