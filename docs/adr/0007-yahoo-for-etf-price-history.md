# ADR-0007: Yahoo's undocumented chart endpoint for US ETF price history, quarantined to the backfill script

- **Status**: Accepted
- **Date**: 2026-09-11
- **Deciders**: user (chose this option explicitly after being shown the alternatives)
- **Related**: [ADR-0002](0002-server-side-provider-gateway.md),
  [ADR-0003](0003-precomputed-daily-briefing-snapshot.md)

---

## Context

The value-history charts need ~3 months of daily closes. The daily job only ever writes *today's*
prices, so `price_daily` begins the day collection was switched on — two rows per security at the
time this was written. Without a historical backfill both charts would render a two-point line and
stay near-useless for weeks.

Every holding except two could be backfilled from providers already integrated. The exceptions were
the US **ETFs** (`SCHD`, `DIVB`). Verified live on 2026-09-10/11:

| Source | Result |
|---|---|
| KRX `stk_bydd_trd` / `etf_bydd_trd` | works for all 8 KRX holdings — any `basDd`, whole market per call |
| ECOS `731Y001` | works — a whole date range in one call |
| Finnhub `/stock/candle` | **403** — candles are a paid feature |
| FMP `/stable/historical-price-eod` | works for `AMZN`/`GOOGL`, **402 for ETF symbols** — the free plan's symbol whitelist excludes them |
| Stooq CSV | **blocked** by a JavaScript proof-of-work challenge; unusable server-side |
| Yahoo `v8/finance/chart` | works for all four US symbols — 64 clean daily points per call, no nulls |

So the options were: adopt an undocumented endpoint, sign up for yet another provider (Twelve Data's
free tier covers ETFs), or ship the total-value chart missing ~6.7% of the portfolio. The third was
rejected outright — a value chart silently omitting two holdings is exactly the kind of
derived-but-authoritative-looking figure spec 0001's Computational Integrity rule forbids.

## Decision

**Use Yahoo's `query1.finance.yahoo.com/v8/finance/chart` endpoint, and confine it to
`scripts/backfill-prices.ts`.**

The endpoint is undocumented, carries no API contract, and can change or start refusing traffic
without notice. That risk is made survivable by *where* it is allowed to run, not by trusting it:

- **Nothing in production depends on it.** The daily job gets US prices — ETFs included — from
  Finnhub `quote`, which works fine; it is only `company-news` and `candle` that exclude ETFs. No
  request path, page, or scheduled job imports `src/lib/providers/yahoo.ts`.
- **If it breaks, the app does not.** The only lost capability is re-running a backfill, and the
  failure surfaces immediately in a script run rather than silently degrading a user-facing screen.
- **It is still a first-class provider.** Requests go through `gatewayCall` (ADR-0002), so they
  inherit caching, the 1 req/s token bucket, Zod validation, and `provider_call_log` accounting like
  every other provider. It is not a raw `fetch` smuggled in beside the gateway.

Because the script is the only consumer, it uses Yahoo for **all four** US symbols rather than
splitting FMP-for-stocks / Yahoo-for-ETFs. One code path, and no dependency on FMP's free-tier
symbol whitelist — which is precisely the thing that broke here and could change again.

Two implementation details worth keeping:

- Yahoo's `timestamp[]` values are the session's **open** instant. Trade dates are derived in UTC
  (`toISOString().slice(0,10)`), which is correct for US sessions and, unlike local-time conversion,
  does not shift dates when the script runs on a KST machine.
- `close[]` carries `null` for halted/holiday sessions; those points are skipped, never interpolated.

## Consequences

**Positive**

- Both charts ship with a real 3-month curve (65 trading days) instead of a two-point line.
- No new account, key, or `.env` variable — the backfill needs no credential at all for the US side.
- The blast radius of the endpoint disappearing is one script, not the app.

**Negative / risks**

- **It may stop working without warning**, and unlike every other provider there is no documentation
  or status page to consult. Mitigation is the quarantine above, not reliability.
- **Terms of service are grey.** This is a personal, non-commercial, single-user app making a handful
  of requests during an occasional manual backfill; that is the basis on which the user accepted it.
  Anything higher-volume or shared would need revisiting — most likely by adopting Twelve Data, the
  option deliberately left on the table here.
- **A third US price source** now exists alongside Finnhub and FMP, each with different coverage.
  That is genuine complexity; it is written down in `src/lib/providers/yahoo.ts`'s header so the next
  reader does not have to rediscover which provider covers what.

## Platform Impact

| Platform | Impact | Files Affected |
|----------|--------|----------------|
| Claude Code | **No governance change.** Adds a provider module and a script; no hook, command, agent, or dispatch rule. | `scripts/backfill-prices.ts`, `src/lib/providers/yahoo.ts` |
| Antigravity (GEMINI.md) | **None — justified.** A provider-integration decision recorded in this platform-neutral ADR, not an AI-tooling behaviour change. | N/A |
| templates/common | **None** — leaf project, no propagation path. | N/A |

## Accessibility Impact

**None directly.** This ADR concerns where historical price data comes from. The charts it enables
carry their own accessibility contract (`role="img"` with a spoken summary, the numeric range
duplicated as text, direction conveyed by a signed percentage rather than colour alone), inherited
from the existing holding-detail sparkline per spec 0002 §3.3.
