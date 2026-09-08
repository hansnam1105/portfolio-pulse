# 0001 — portfolio-pulse System Design

- **Version**: 3 (application-level authentication removed per explicit user decision)
- **Status**: Proposed — v3 (auth removed per user decision), awaiting final approval before
  code-writer.
- **Author**: architect
- **Date**: 2026-09-08 (v2: 2026-09-08, v1: 2026-09-08)
- **Related ADRs**: [ADR-0001](../adr/0001-tech-stack-nextjs-vercel-postgres.md),
  [ADR-0002](../adr/0002-server-side-provider-gateway.md),
  [ADR-0003](../adr/0003-precomputed-daily-briefing-snapshot.md),
  [ADR-0004](../adr/0004-manual-holding-adjustments.md) **(new in v2)**
- **Risk**: HIGH — this plan creates substantially more than 3 files (it bootstraps an empty
  project), and v2 widens it further with the manual-adjustment layer. v3 narrows it slightly (two
  files and five env vars removed) but the plan remains well over the 3-file threshold. Per the
  architect constraint, **explicit user confirmation is required before any implementation begins.**
- **v3 note on the ADR set**: no ADR is superseded. ADR-0003's job-endpoint clause is *narrowed* —
  its "or an authenticated user session" alternative no longer exists; a cross-reference is recorded
  in ADR-0001 §Consequences, ADR-0003 §Decision, and ADR-0004 §5. No new ADR is required, because
  "no auth" is the absence of an architectural component rather than a new one.

## What changed in v3

**Application-level authentication is removed.** The user has decided this prototype is single-user
and will not be shared, so the Google OAuth / Auth.js layer (login screen, session middleware,
`src/lib/auth.ts`, and the five `AUTH_*` env vars) is deleted from the design; `CRON_SECRET` remains
as the only request guard. See § Authentication for the decision and its recorded trade-off. Nothing
else in the design changes — no data-model, parser, provider, or briefing change. This supersedes the
Q3 answer recorded in v2.

## What changed in v2

All seven v1 open questions were answered by the user. Two answers changed the *design*, not just
the documentation:

| Q | Answer | Design impact |
|---|--------|---------------|
| **Q1** format | Real sample supplied and analyzed; redacted fixture committed | **Major.** The export has only 4 columns and **carries no quantity, no ticker code, and no as-of date.** Forces a value-based position model, name-based security resolution, and an explicit `as_of_date`. See § Parser profile. |
| **Q6** cadence | User will **not** re-upload per trade; wants in-app manual buy/sell entry | **Major.** New `manual_transaction` table, new `current_holding` computation, new screen + routes — recorded as [ADR-0004](../adr/0004-manual-holding-adjustments.md). |
| Q2 hosting | Vercel Hobby confirmed | none — confirmation only |
| Q3 auth | Google OAuth + single-email allowlist confirmed | ~~passcode fallback formally rejected; env vars fixed~~ — **SUPERSEDED IN v3: no application-level auth at all.** See § Authentication. |
| Q4 colour | Korean convention app-wide (up = red, down = blue) | finalized in § Accessibility |
| Q5 model/lang | Korean briefing; `GEMINI_MODEL` default `gemini-3.6-flash` | finalized in § Environment + § Accessibility |
| Q7 KRX scope | Delegated to architect judgment | v1 assumption retained, now explicitly labelled an assumption |

Q1 and Q6 interact: because the export carries no share count, a manual transaction (which *does*
carry a share count) cannot simply be added to an export row. ADR-0004 §3 defines the exact merge.

---

## Implementation Plan

### Summary

portfolio-pulse is a single-user, mobile-first web app that answers one question every morning:
*"what happened overnight that matters to the stocks I actually own?"* The user periodically
uploads one Samsung Securities export containing both KRX-listed and US-listed holdings; the app
parses it into an append-only position snapshot, and a once-daily scheduled job fans out to seven
read-only data providers (KRX, DART, ECOS, Finnhub, FMP, Naver) scoped strictly to the tickers the
user currently holds, then makes a **single batched Gemini call** that returns a structured
briefing which is persisted and served as a static read. Between exports, the user records trades
directly in the app as manual transactions, so "what I actually own" stays current without a fresh
export (ADR-0004).

The architecture is deliberately boring: **Next.js 15 (App Router) + TypeScript on Vercel Hobby,
with Neon Postgres via Drizzle ORM**. That choice is driven by three hard constraints — (1) no
external API key may ever reach the browser, which requires a real server runtime and rules out any
static/SPA-only deployment; (2) the workload is one scheduled batch job per day plus a handful of
personal page views, which is squarely inside free tiers and does not justify container/VPS
operations for a solo user; (3) the briefing must be *cheap*, so LLM inference is precomputed once
per day and stored, never invoked per page view. Three architectural decisions are recorded
separately as ADRs: the stack (0001), the server-only Provider Gateway that owns every secret and
every outbound call (0002), and the precomputed-snapshot briefing model (0003).

Everything the user sees is read from Postgres. Nothing the user sees triggers an outbound call to
a paid or rate-limited API. That single property is what keeps this project inside a free tier and
inside its security requirement at the same time.

---

### Files to change

Directory conventions follow `docs/co-develop.context.md § File Organization Policy`. Application
source lives under `src/`; the existing workspace `scripts/` tree is governance tooling and is
**not** touched.

| File | Action | Description |
|------|--------|-------------|
| `package.json` | modify | Add app deps/scripts (`dev`, `build`, `start`, `db:generate`, `db:migrate`, `test`) alongside the existing governance scripts. Must not remove any existing workspace script. |
| `next.config.ts` | create | Next.js config; `serverExternalPackages` for the Postgres driver; strict headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`). |
| `tsconfig.json` | create | Strict TypeScript config (`strict`, `noUncheckedIndexedAccess`), `@/*` path alias to `src/`. |
| `drizzle.config.ts` | create | Drizzle Kit config pointing at `src/db/schema.ts` and `DATABASE_URL`. |
| `.env.sample` | modify | Add the 7 new non-provider vars + `GEMINI_MODEL` (see § Environment). **`.env` is never read or written by this project's agents.** |
| `src/app/layout.tsx` | create | Root layout; viewport meta for mobile; theme provider wired to `tokens.json` CSS custom properties. |
| `src/app/(app)/page.tsx` | create | **Today's Briefing** — default landing screen. Server Component reading the latest `briefing` row. |
| `src/app/(app)/portfolio/page.tsx` | create | Holdings list from the latest snapshot, grouped KR / US, with valuation. |
| `src/app/(app)/holdings/[securityId]/page.tsx` | create | Per-holding detail: position, price history, linked news/disclosures, latest briefing item. |
| `src/app/(app)/transactions/page.tsx` | create | **NEW in v2 (ADR-0004)** — manual transaction list + add/edit form (buy / sell / set quantity / remove). Also reachable as an "adjust" action from the holding-detail screen. |
| `src/app/(app)/upload/page.tsx` | create | Upload screen: file picker, `as_of_date` confirmation, parse preview (diff vs. **current holdings**, not just the previous snapshot), list of manual transactions that this upload will supersede, confirm/commit. |
| `src/app/(app)/settings/page.tsx` | create | Job status, provider health, last-run log, manual "regenerate briefing" trigger. **v3: no sign-out control — there is no session.** |
| `src/app/api/upload/route.ts` | create | `POST` multipart handler → parse → staging preview; `POST /commit` → persist snapshot. |
| `src/app/api/transactions/route.ts` | create | **NEW in v2 (ADR-0004)** — `POST` create / `PATCH` edit a manual transaction. Makes no outbound provider call. **v3: no session guard — see § Authentication.** |
| `src/app/api/transactions/[id]/route.ts` | create | **NEW in v2 (ADR-0004)** — `DELETE` = soft void (`voided_at`), never a row deletion. |
| `src/app/api/jobs/daily-briefing/route.ts` | create | Trigger-agnostic job endpoint guarded by `CRON_SECRET` bearer token (ADR-0003). |
| `src/db/schema.ts` | create | Drizzle schema — all tables in § Data model. |
| `src/db/index.ts` | create | Pooled Neon/Postgres client, `import 'server-only'`. |
| `src/db/migrations/` | create | Generated SQL migrations (checked in). |
| `src/lib/providers/gateway.ts` | create | The single choke point for all outbound provider calls: secret injection, cache, rate limiter, Zod validation, call logging (ADR-0002). |
| `src/lib/providers/{krx,dart,ecos,finnhub,fmp,naver}.ts` | create | Six thin typed clients registered with the gateway; each owns its Zod response schema and its cadence/TTL declaration. |
| `src/lib/providers/gemini.ts` | create | Gemini client: builds the batched briefing prompt, requests structured JSON, validates with Zod, records token usage. |
| `src/lib/parsers/samsung-securities.ts` | create | Export parser. **XLSX path is now the primary path** (the real sample is `.xlsx`); the CSV/encoding path is retained as a fallback for a future CSV export. Header-profile mapping + numeric normalization. |
| `src/lib/parsers/profiles/samsung-securities.json` | create | **Data, not code**: column-header → canonical-field mapping, versioned. **v2: now written from the real headers** (§ Parser profile), not guessed. Lets a richer future export be supported without a code change. |
| `src/lib/holdings/current.ts` | create | **NEW in v2 (ADR-0004)** — the `current_holding` fold: latest snapshot ⊕ later manual transactions, running average cost, `quantity_basis` derivation, over-sell rejection, missing-price fallback. The single place this computation exists. |
| `src/lib/securities/resolve.ts` | create | Maps a parsed row to a `security` row. **v2: resolution is by display label**, since the export carries no ticker code — Korean local name (incl. `우`/`우B` preferred suffixes) for KRW rows, symbol for USD rows, with `security_alias` as the manual override path. Materially more load-bearing than v1 assumed. |
| `src/lib/briefing/build.ts` | create | Orchestrates the daily job: collect → prompt → persist, idempotent per `briefing_date`. |
| `src/lib/money.ts` | create | Decimal-safe money/quantity helpers. **No floating-point arithmetic on money** (see § Computational Integrity). |
| ~~`src/lib/auth.ts`~~ | **removed in v3** | Session issue/verify. **Deleted from the plan** — no application-level auth (§ Authentication). No auth middleware file is created either. |
| `src/components/**` | create | Mobile-first UI primitives consuming `tokens.json` semantic tokens only (no raw hex/px — `token-usage-lint` skill applies). |
| `vercel.json` | create | Cron schedule declaration for the daily job. |
| `docs/co-develop.context.md` | modify | Fill in the currently-placeholder **Tech Stack** table with the ADR-0001 outcome. |
| `docs/specs/0002-portfolio-pulse-ui-spec.md` | (follow-on) | Owned by the **designer** agent, not this plan. Screen inventory below is input to it, not a substitute. |
| `docs/benchmark-fixtures/samsung-securities-sample.xlsx` | **created in v2** | Redacted parser fixture — real structure, zero real financial data. Provenance and redaction statement in `samsung-securities-sample.md`. |
| `docs/benchmark-fixtures/samsung-securities-sample.md` | **created in v2** | Fixture provenance, redaction statement, column table, covered edge cases. |
| `tests/**` | create | Unit tests for parser, resolver, money, gateway cache/limiter, **and the `current_holding` fold (ADR-0004: ordering, over-sell rejection, supersession boundary, missing-price fallback, estimated-vs-exact quantity)**; integration test for the job endpoint against fixtures. Per `[DEVELOP-R1]`, every implementation gets a test. |

---

### Data model / API surface

#### Parser profile — derived from the real export (Q1, resolved)

The user supplied a real export. It was read structurally only; no real value appears in this spec,
in the committed fixture, or in any other artifact. Redacted fixture:
[`docs/benchmark-fixtures/samsung-securities-sample.xlsx`](../benchmark-fixtures/samsung-securities-sample.xlsx)
(provenance: [`samsung-securities-sample.md`](../benchmark-fixtures/samsung-securities-sample.md)).

**Actual format**: `.xlsx` (OOXML), exactly one sheet named `Sheet1`, header in row 1, contiguous
data from row 2, **four columns**, no merged cells, no section headers, no subtotal rows, no number
formats applied.

`src/lib/parsers/profiles/samsung-securities.json` — profile `v1`, mapping the real headers:

| Col | Header (verbatim) | → canonical field | Type | Notes |
|-----|-------------------|-------------------|------|-------|
| A | `종목명` | `raw_label` | string | Korean local name for KRW rows; ticker symbol for USD rows |
| B | `통화` | `currency` | enum `KRW` \| `USD` | **the sole KRX-vs-US discriminator** |
| C | `평가금액` | `market_value` | decimal | in the row's own currency |
| D | `매수금액` | `cost_basis_total` | decimal | in the row's own currency |

```jsonc
// src/lib/parsers/profiles/samsung-securities.json  (design, not code)
{
  "profileVersion": "samsung-securities/v1",
  "format": "xlsx",
  "sheet": { "match": "first" },          // real file: single sheet named "Sheet1"
  "headerRow": 1,
  "dataStartRow": 2,
  "columns": {
    "종목명":   { "field": "raw_label",        "type": "string",  "required": true },
    "통화":     { "field": "currency",         "type": "enum",    "values": ["KRW", "USD"], "required": true },
    "평가금액": { "field": "market_value",     "type": "decimal", "required": true },
    "매수금액": { "field": "cost_basis_total", "type": "decimal", "required": true }
  },
  "marketFrom": "currency",               // KRW -> KRX, USD -> US
  "absent": ["quantity", "price", "ticker_code", "isin", "as_of_date", "account_id"]
}
```

**Four structural facts drive the rest of this design:**

1. **No quantity and no per-share price.** A position cannot be repriced from the export alone.
   Quantity is back-derived (`평가금액 ÷ close`) and marked `estimated`; ADR-0004 §3 defines this and
   the `set_quantity` remedy that makes it exact.
2. **No ticker code, no ISIN.** Security resolution is by display *label*. Korean preferred shares
   (`…우`, `…우B`) are distinct securities sharing a name prefix — the resolver must not normalize
   the suffix away. `security_alias` is the manual repair path and is expected to be used, not
   exceptional.
3. **No as-of date.** `portfolio_snapshot.as_of_date` is set at commit time (defaults to the upload
   date, user-editable). It is the boundary that decides which manual transactions still apply.
4. **XLSX, not CSV.** The CP949/EUC-KR mojibake risk flagged in v1 does not apply to this format —
   OOXML strings are UTF-8 inside the zip. The CSV decoding path stays in the parser as a fallback
   only.

> ⚠️ **Architect note, flagged rather than assumed.** The supplied sample has the characteristics of a
> hand-prepared extract rather than a raw brokerage download: workbook created in the project folder,
> ~90 seconds between creation and last save, default sheet name `Sheet1`, no account header block,
> no broker branding, no number formatting. A raw Samsung Securities download very plausibly contains
> **more** columns (share count, average price, ticker code, account header rows). The profile above
> is correct for the file actually provided and is versioned data precisely so a richer real export
> can be supported by adding `samsung-securities/v2` without touching parser code. **If the user has
> a raw, unedited download, supplying it would remove the need for the quantity derivation entirely
> — this is the single highest-value follow-up input.** See Open Question Q1-b.

#### Design principle: append-only snapshots, plus an append-only adjustment layer

The user re-uploads a full export periodically, not deltas. Modelling holdings as a mutable
`positions` table would destroy history and make a re-upload destructive. Instead, **each upload
creates an immutable `portfolio_snapshot`**. This gives position history, safe re-uploads, trivial
rollback, and file-hash idempotency for free — at the cost of one join on every read, which is
irrelevant at this data volume.

**v2 change (Q6, ADR-0004):** the user does not want to re-export on every trade, so "my current
portfolio" is no longer "the latest snapshot's holdings". It is now:

> **the latest snapshot's holdings, folded with every non-voided, non-superseded
> `manual_transaction` dated after that snapshot's `as_of_date`.**

Manual transactions are a *second append-only table*, not edits to the first. An "edit" rewrites a
row's fields and bumps `updated_at`; a "delete" sets `voided_at`. The snapshot layer stays exactly as
designed in v1 — broker-authoritative, immutable, idempotent — and the adjustment layer stays
user-authored and clearly labelled as such. Keeping them separate is what lets any displayed figure
say where it came from.

#### Tables

```
security                  -- instrument master
  id              pk
  market          enum('KRX','US')
  symbol          text          -- '005930' (KRX 6-digit) | 'AAPL'
  name_local      text          -- 삼성전자
  name_en         text?
  currency        enum('KRW','USD')
  isin            text?
  sector          text?
  corp_code       text?         -- DART corp_code, KRX only
  created_at, last_refreshed_at
  unique (market, symbol)

security_alias            -- manual override for unresolvable export rows
  id pk, security_id fk, raw_label text, note text
  unique (raw_label)

portfolio_snapshot        -- one row per accepted upload  (APPEND-ONLY)
  id              pk
  uploaded_at     timestamptz
  as_of_date      date          -- v2/ADR-0004: effective date of the export, Asia/Seoul.
                                -- The export has NO date column, so this defaults to the
                                -- upload date and is user-editable at commit. It is the
                                -- boundary for manual-transaction supersession, so it is
                                -- the comparison key -- never uploaded_at.
  source_filename text
  file_sha256     text unique   -- idempotency: same file never double-commits
  broker          text default 'samsung-securities'
  profile_version text          -- which parser profile produced this ('samsung-securities/v1')
  row_count       int
  warnings        jsonb         -- unresolved rows, coerced values

holding                   -- positions belonging to ONE snapshot
  id pk, snapshot_id fk, security_id fk
  raw_label       text          -- v2: 종목명 verbatim; the ONLY security identifier the export gives
  quantity        numeric(24,8)?  -- v2: NULLABLE. profile v1 supplies no share count.
  avg_cost        numeric(24,8)?  -- v2: NULLABLE. derivable only when quantity is known.
  cost_basis_total numeric(24,8)  -- v2: 매수금액. EXACT, always present. Total, not per-share.
  market_value_at_upload numeric(24,8)  -- v2: 평가금액. EXACT, always present.
  currency        enum('KRW','USD')
  raw             jsonb         -- original row, for audit
  unique (snapshot_id, security_id)

  -- v2 note: unrealized P/L for the snapshot instant is EXACT and provider-free:
  --   market_value_at_upload - cost_basis_total.
  -- What the missing quantity costs is the ability to REPRICE after as_of_date.

manual_transaction        -- v2 / ADR-0004. APPEND-ONLY, like the snapshot.
  id                    pk
  security_id           fk -> security
  kind                  enum('buy','sell','set_quantity','remove')
  quantity              numeric(24,8)?   -- required: buy, sell, set_quantity
  price                 numeric(24,8)?   -- per-share, required: buy, sell
  fees                  numeric(24,8) default 0
  cost_basis_total      numeric(24,8)?   -- optional override, used with set_quantity
  currency              enum('KRW','USD')
  transaction_date      date             -- Asia/Seoul; the ordering + supersession key
  note                  text?
  created_at            timestamptz
  updated_at            timestamptz
  voided_at             timestamptz?     -- user "delete" = soft void; rows are never removed
  superseded_by_snapshot_id  fk -> portfolio_snapshot ?
  index (security_id, transaction_date)

price_daily
  security_id fk, trade_date date, close numeric(24,8),
  prev_close numeric(24,8)?, currency, source text
  pk (security_id, trade_date)

fx_rate_daily
  pair text, rate_date date, rate numeric(24,8), source text
  pk (pair, rate_date)          -- 'USDKRW' from ECOS

macro_observation
  series_code text, obs_date date, value numeric(24,8), unit text, source text
  pk (series_code, obs_date)    -- ECOS: base rate, CPI, USD/KRW

news_item                 -- unified: news AND regulatory disclosures
  id pk
  kind            enum('news','disclosure')
  source          enum('finnhub','naver','dart')
  external_id     text?
  url             text
  url_sha256      text unique   -- dedupe across sources
  title           text
  summary         text?
  lang            enum('ko','en')
  published_at    timestamptz
  raw             jsonb

news_link                 -- m2m: one article can mention several holdings
  news_item_id fk, security_id fk, relevance enum('primary','mentioned')
  pk (news_item_id, security_id)

briefing                  -- one per calendar day (ADR-0003)
  id pk
  briefing_date   date unique
  status          enum('pending','running','ok','partial','failed')
  generated_at    timestamptz?
  model           text          -- resolved GEMINI_MODEL, recorded not assumed
  prompt_version  text
  input_digest    text          -- sha256 of the prompt inputs; skip regen if unchanged
  overview_md     text?         -- market/macro paragraph
  token_usage     jsonb?
  degraded_sources text[]       -- providers that failed; briefing still ships
  error           text?

briefing_item             -- per-holding section of a briefing
  id pk, briefing_id fk, security_id fk
  headline        text
  body_md         text
  sentiment       enum('positive','neutral','negative','unclear')
  cited_news_ids  bigint[]      -- must be a subset of the news fed to the model
  unique (briefing_id, security_id)

provider_cache            -- Postgres-as-cache; no Redis (ADR-0002)
  cache_key text pk, provider text, payload jsonb,
  fetched_at timestamptz, expires_at timestamptz

provider_call_log         -- quota awareness + debugging
  id pk, provider text, endpoint text, called_at timestamptz,
  status int?, ok bool, latency_ms int?, error text?

job_run
  id pk, job_name text, run_date date, status enum(...),
  started_at, finished_at, steps jsonb, error text?
  unique (job_name, run_date)   -- makes the daily job idempotent
```

#### `current_holding` — the exact computation (v2 / ADR-0004)

A database view (materialization is an optimization decision, not a design one), mirrored by
`src/lib/holdings/current.ts` as the single place this fold exists. All arithmetic in the security's
native currency, through the decimal helpers in `src/lib/money.ts` — **never** IEEE-754 floats.

```
Let S = the latest portfolio_snapshot
    H = S's holding row for this security          (absent for a newly-bought security)
    T = manual_transaction rows for this security where
          transaction_date > S.as_of_date
          AND voided_at IS NULL
          AND superseded_by_snapshot_id IS NULL
        ordered by (transaction_date, created_at)

Base leg (from the export):
  c_base = H.cost_basis_total                            -- 매수금액, EXACT
  q_base = H.quantity                                    if the profile supplies quantity (v2+)
         = H.market_value_at_upload
             / price_daily(security, S.as_of_date)       otherwise            [ESTIMATED]
         = 0                                             if H is absent

Fold T in order over (q, c), starting at (q_base, c_base):
  buy           q += t.quantity ;  c += t.quantity * t.price + t.fees
  sell          q -= t.quantity ;  c -= t.quantity * (c / q)    -- avg cost BEFORE this row
  set_quantity  q  = t.quantity ;  c  = COALESCE(t.cost_basis_total, c)
  remove        q  = 0          ;  c  = 0

Result per security:
  quantity_current = q
  cost_basis       = c
  value_current    = q * latest_close(security)          -- x FX for the KRW-normalized total
  unrealized_pl    = value_current - cost_basis
  quantity_basis   = 'exact'      if q_base came from the export, or a set_quantity row was applied
                   = 'estimated'  otherwise
```

**Degenerate cases are explicit, not incidental:**

- `price_daily` for `as_of_date` missing or zero → `q_base` is undefined. The position falls back to
  displaying `market_value_at_upload` as a frozen *"as of `as_of_date`"* figure, marked stale, and its
  manual transactions are listed separately rather than silently folded into a wrong total.
- A `sell` that would drive `q` below zero is **rejected at write time** with a validation error that
  names the current quantity (an accessibility requirement too — WCAG 3.3.3).
- `quantity_basis = 'estimated'` must be surfaced in the UI as text or an icon with an accessible
  name. A back-derived share count is never presented as a broker-reported fact.

**Reconciliation on a new upload** (inside the same transaction as the snapshot insert): every
non-voided `manual_transaction` with `transaction_date <= S_new.as_of_date` and no existing
supersession gets `superseded_by_snapshot_id = S_new.id`. They stop contributing but remain
queryable — chosen over hard-deletion (destroys the audit trail) and over leaving them active
(silently double-counts). Full trade-off in ADR-0004 §4.

**The daily briefing job reads its security list from `current_holding`**, not from the latest
snapshot directly, so a manually-bought stock is covered by the next briefing without an export.

#### Internal API surface

All routes are server-side. **v3: there is no session and no auth middleware** — the routes below are
reachable by anyone who can reach the deployment, exactly like the pages (§ Authentication). The only
guarded endpoint is the job trigger, which carries a bearer secret because it spends provider quota.
There is still no *public* API in the sense that matters for ADR-0002: no route turns a browser
request into an outbound provider call, so no route can leak or burn a provider key.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/upload` | multipart file → parse only. Returns `{ parsed[], unresolved[], warnings[], diffVsCurrent, willSupersede[] }`. **Writes nothing.** v2: the diff is against `current_holding`, and `willSupersede[]` lists the manual transactions the commit would retire. |
| `POST` | `/api/upload/commit` | Commits a previewed parse as a new `portfolio_snapshot` with a user-confirmed `as_of_date`, and applies supersession in the same transaction. Rejects a `file_sha256` already present. |
| `POST` | `/api/securities/alias` | Resolve an `unresolved` row by binding a raw label to a security. **v2: expected to be routine**, since the export gives no ticker code. |
| `POST` / `PATCH` | `/api/transactions` | **NEW in v2 (ADR-0004)** — create / edit a manual transaction. Validates kind-specific required fields and rejects an over-sell against `current_holding`. |
| `DELETE` | `/api/transactions/[id]` | **NEW in v2 (ADR-0004)** — soft void (`voided_at`). Never removes the row. |
| `POST` | `/api/jobs/daily-briefing` | Runs/reruns the daily job. **v3 auth: `Authorization: Bearer $CRON_SECRET` only.** The "or an authenticated user session" clause is deleted — there is no session. A request without the bearer token is 401, unconditionally. |
| `GET` | `/api/health` | Job freshness + per-provider last-success timestamp. No secrets in the response. |

Page data is read directly in Server Components — no client-side data-fetching layer, so no
JSON API surface exists for the browser to call and therefore no place for a key to leak.

**The `/settings` "regenerate briefing" button is a Server Action with no auth check** — chosen
plainly over routing it through the bearer-token endpoint, because with the session boundary gone
there is nothing left for that check to distinguish: anyone who can load `/settings` can already
read the whole portfolio, so requiring a secret on a button rendered on that same page would be
theatre, not a control. The Server Action calls `src/lib/briefing/build.ts` directly and inherits the
job's own `job_run` + `input_digest` idempotency, so repeated clicks cost at most one Gemini call per
day. `CRON_SECRET` stays mandatory on the HTTP endpoint because that path is machine-callable at a
guessable URL by anything that scans the deployment, and its cost is real provider quota.

#### Provider integration matrix

Every entry runs **server-side only**, through `gateway.ts`, keyed from `process.env`.

| Provider | Env var(s) | Used for | Fetch cadence | Cache TTL |
|----------|-----------|----------|---------------|-----------|
| KRX Open API | `KRX_API_KEY` | KRX close prices for held Korean tickers (**assumed scope**, see Q7) | daily, after KRX close | until next trading close |
| DART OpenAPI | `DART_API_KEY` | disclosures for held Korean tickers | daily job | 12 h |
| BOK ECOS | `ECOS_API_KEY` | base rate, CPI, USD/KRW | daily job | 24 h |
| Finnhub | `FINNHUB_API_KEY` | US quotes + company news | daily, after US close | 12 h |
| FMP | `FMP_API_KEY` | US fundamentals (slow-moving) | weekly, on demand for new tickers | 7 d |
| Naver Search | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | Korean-language news per held name | daily job | 12 h |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.6-flash`, see § Environment) | one batched briefing generation, **written in Korean** | **exactly once per day** | n/a (output persisted) |

**Fan-out is bounded by holdings, not by market.** The job never scans a universe; it iterates the
securities in `current_holding`. With a typical personal portfolio this is on the order of tens of
calls per provider per day.

**Price data is now load-bearing beyond display (v2).** Because the export has no quantity,
`price_daily(security, as_of_date)` is an *input to the position itself*, not only to its valuation.
A missing close price for a KRW holding on the snapshot date degrades that position to a frozen
as-of figure. This raises the practical importance of the KRX price fetch and is another reason to
confirm Q7 early.

⚠️ **Unverified**: published free-tier rate limits for Finnhub, Naver Search, DART, ECOS and Gemini
were not fetched during this design (no network verification performed). The gateway is therefore
built to *discover* limits safely rather than to assume them: a conservative per-provider token
bucket (default 1 request/second, configurable per provider), sequential-by-provider execution, and
`provider_call_log` so real quota consumption is measurable after the first live runs. Recommend
confirming each provider's documented limits at implementation time and encoding them in the
provider registry.

#### Job sequence (once per day)

```
1.  claim job_run (job_name='daily-briefing', run_date=today)  -- unique key = idempotent
2.  load current_holding (latest snapshot (+) later manual transactions) -> securities[]   [v2]
3.  fan out, per provider, rate-limited, cache-first:
      KRX/Finnhub -> price_daily        ECOS -> fx_rate_daily, macro_observation
      DART/Naver/Finnhub -> news_item + news_link
    (a provider failure is recorded in degraded_sources and does NOT abort the job)
4.  assemble prompt inputs -> input_digest
5.  if a briefing for today exists with the same input_digest -> stop (no LLM call)
6.  ONE Gemini call, structured-JSON response, Zod-validated
7.  persist briefing + briefing_item rows in a transaction; status ok | partial
8.  close job_run
```

Recommended trigger time **07:00 KST (22:00 UTC)**: the prior US session and the prior KRX session
have both closed.

---

### Trade-offs considered

| Option | Pro | Con | Decision |
|--------|-----|-----|---------|
| **Next.js 15 App Router** | Server Components keep secrets and data access server-side by default; one deploy unit; route handlers give the job endpoint for free | Framework weight for a small app; App Router caching semantics need care | **Chosen** (ADR-0001) |
| SvelteKit | Lighter, excellent mobile output | Smaller ecosystem for the fintech/parsing bits; team/agent familiarity lower | Rejected |
| Hono API + separate React SPA | Clean separation | Two deploy units, two auth surfaces, more places a key can leak | Rejected |
| Python FastAPI + HTMX | Best data/parsing libraries (pandas) | Second language in a TypeScript-standard workspace; heavier hosting | Rejected |
| **Neon Postgres (serverless)** | Free tier; real SQL types incl. `numeric`; survives ephemeral compute; scale-to-zero | Cold-start on first query after idle | **Chosen** (ADR-0001) |
| Turso / libSQL (SQLite) | Very cheap, low latency | Weaker decimal/`numeric` story for money; less familiar ops | Rejected |
| Supabase | Postgres + auth bundled | More product than needed; auth features unused for one user | Rejected |
| Local SQLite file | Simplest | Incompatible with ephemeral serverless filesystems | Rejected |
| **Drizzle ORM** | Thin, SQL-shaped, excellent TS inference, tiny cold start | Fewer batteries than Prisma | **Chosen** |
| Prisma | Mature tooling | Heavier engine/cold start on serverless | Rejected |
| **Vercel Hobby** | Free for personal non-commercial use; zero ops; native cron | Hobby cron is coarse (≈ once/day, imprecise trigger time) | **Chosen**, with a trigger-agnostic endpoint as mitigation |
| Cloudflare Workers + D1 | Generous free tier, precise cron | Next.js-on-Workers friction; D1 decimal handling | Rejected |
| Small VPS | Full control, precise scheduling | The user pays in ops time forever | Rejected |
| **Trigger-agnostic job endpoint (`CRON_SECRET`)** | Works with Vercel Cron *or* GitHub Actions *or* a manual button; not locked to one scheduler | One more secret | **Chosen** (ADR-0003) |
| **Precompute briefing once/day, persist** | Bounded LLM cost; instant page loads; reproducible; works offline-ish | Content is up to 24 h stale | **Chosen** (ADR-0003) |
| On-demand LLM per page view | Always fresh | Unbounded cost on the free tier; slow mobile loads; non-reproducible | Rejected |
| **Postgres table as provider cache** | No extra infra, no extra bill, inspectable | Slower than Redis (irrelevant here) | **Chosen** |
| Upstash Redis | Fast | Another service + another secret for no benefit at this scale | Rejected |
| **Append-only snapshots** | Free history, safe re-upload, idempotent | One join per read | **Chosen** |
| Mutable positions table | Simplest read | Destroys history; a bad upload is unrecoverable | Rejected |
| **Manual transactions as a second append-only layer** (v2) | Portfolio stays current between exports; provenance of every figure preserved; snapshot layer untouched | `current_holding` becomes an ordered fold, not a select; needs its own test suite | **Chosen** (ADR-0004) |
| Make `holding` rows editable | Trivially simple "edit a holding" | Destroys the four properties append-only bought; a re-upload silently overwrites the user's manual work | Rejected |
| Require a fresh export after every trade (v1 behaviour) | No new tables | Explicitly rejected by the user — the whole point of Q6 | Rejected |
| **Supersede + retain manual transactions on upload** | No double-counting; audit trail survives; reversible | A few rows kept forever | **Chosen** (ADR-0004 §4) |
| Hard-delete superseded transactions | Tidier table | Destroys the record of what the user acted on; a wrong `as_of_date` becomes unrecoverable | Rejected |
| Keep superseded transactions active | No reconciliation step | **Silently double-counts** a trade that the export already reflects — the worst failure available to this app | Rejected |
| **Back-derive quantity from 평가금액 ÷ close, marked `estimated`** (v2) | Enables repricing despite the export's missing share count; `set_quantity` upgrades it to exact | An estimate; distorted by splits, fractional shares, intraday-priced exports | **Chosen**, with the marker and the fallback as mandatory mitigations |
| Show only the frozen as-of-upload value | Always exactly true | Portfolio is stale the moment it is uploaded; defeats Q6 | Rejected as the default (retained as the missing-price fallback) |
| Ask the user to type every share count up front | Exact from day one | Tedious; the user asked for less manual work, not more | Rejected as mandatory (available on demand via `set_quantity`) |

---

### Cross-platform considerations

- **Windows (PowerShell)** — the development machine. Use `> $null` / `Out-Null`, never `> nul`
  (workspace `nul` safeguard). All app scripts run through `bun run <name>`; no `.ps1` counterparts
  (ADR-0036). Line endings are governed by the existing `.gitattributes`; the parser must not
  depend on `\r\n` vs `\n`.
- **Unix (Bash)** — CI and the Vercel build environment. Use `> /dev/null 2>&1`. File paths in
  source must always be POSIX-style / `path.join`-constructed, never backslash literals.
- **Encoding** — **downgraded in v2.** The real export is `.xlsx`, and OOXML stores strings as UTF-8
  inside the zip, so the CP949/EUC-KR mojibake risk flagged in v1 does not apply on the primary path.
  The parser keeps a CSV branch with explicit encoding sniffing (`TextDecoder('euc-kr')`) as a
  fallback in case a future export is CSV. Korean text still crosses the whole system (security
  names, Naver news, the Korean-language briefing), so all files this project writes remain UTF-8
  without BOM, and terminal output on Windows still needs `chcp 65001` per the workspace rule.
- **Time zones** — the app is KST-centric while the runtime is UTC. All timestamps are stored as
  `timestamptz`; all *dates* (`trade_date`, `briefing_date`) are explicitly Asia/Seoul calendar
  dates computed via a single helper, never via the host locale. Set `TZ=Asia/Seoul` in the
  deployment env as a belt-and-braces measure.

---

### Platform Impact (MANDATORY)

| Platform | Impact | Files Affected |
|----------|--------|----------------|
| Claude Code | **Changes required** — the tech stack this ADR set decides is currently a placeholder in the variant context file that every agent reads at session start; it must be filled in so code-writer/test-runner inherit the correct stack. `.env.sample` gains the vars in § Environment. **v2 adds no governance change**: the manual-adjustment layer (ADR-0004) introduces no hook, command, agent, dispatch rule, env var, or secret — it is entirely internal to the app's own database. **v3 adds no governance change either** — removing auth *shrinks* the surface: five `AUTH_*` vars leave `.env.sample`, no hook/command/agent/dispatch rule is touched, and no new secret is introduced. No change to `CLAUDE.md` itself. | `docs/co-develop.context.md` (Tech Stack table), `.env.sample` |
| Antigravity (GEMINI.md) | **None** — justified. `GEMINI.md` governs *AI-tooling behavior* (Antigravity tool mapping, subagent dispatch, hook parity), and this plan changes none of it: no new slash command, no new skill, no new agent, no change to dispatch order or model tiers. The stack information Antigravity needs is not tool behavior and is read from the shared `docs/co-develop.context.md`, which is platform-neutral and *is* being updated above — so Antigravity picks the change up without a `GEMINI.md` edit. Duplicating stack facts into `GEMINI.md` would create a second source of truth and violate the one-directional inheritance rule. | N/A |
| templates/common | **None — this is a leaf project, not a workspace template.** No propagation path exists from `Projects/portfolio-pulse` to `templates/common`. Should this app later be promoted to a variant, propagation is decided by the `project-to-variant` skill at that time, not here. | N/A |

---

### Security

The non-negotiable requirement — *no external API key ever reaches the browser* — is enforced
structurally rather than by convention (full rationale in ADR-0002):

1. **Single choke point.** Every outbound provider call goes through `src/lib/providers/gateway.ts`.
   No component, page, or client module imports a provider client directly.
2. **`import 'server-only'`** at the top of `gateway.ts` and `src/db/index.ts` — a client component
   importing them fails the build, not production.
3. **No `NEXT_PUBLIC_` provider vars, ever.** Only `NEXT_PUBLIC_`-prefixed vars are inlined into the
   client bundle by Next.js; none of the 8 provider secrets carry that prefix, and a build-time
   check should assert that no known secret name appears in the client bundle.
4. **No browser-callable proxy.** There is deliberately no `/api/quote?symbol=` style passthrough
   route: pages read from Postgres, so there is no endpoint that turns a browser request into a
   provider request. This also removes the ability for anyone to burn the user's quota.
5. **Response bodies are never echoed verbatim** to the client; each provider response is
   Zod-narrowed to the fields the app needs, so an error payload that happens to contain a request
   URL with a key in it cannot reach a page.
6. **Secrets in `.env` locally, Vercel Environment Variables in production.** `.env` stays
   gitignored and is never read by an agent. `gitleaks` (`.gitleaks.toml` already present) covers
   accidental commits.
7. **v3: application-level auth is removed at the user's explicit direction.** The five properties
   above are unaffected — they protect *provider keys*, and they are structural (server-only imports,
   no browser-callable proxy), not session-dependent. What is no longer protected is the *portfolio
   data itself*: anyone who can reach the deployment URL can read it. This is a deliberate, recorded
   acceptance of risk, not an oversight. See § Authentication.
8. `provider_call_log` stores endpoint paths **with query strings stripped**, so keys passed as
   query parameters (KRX, DART, ECOS style) are not persisted into the database.

Security review by the `security-monitor` agent is required before the first PR, per
`[DEVELOP-R1]` (this change touches secrets and infra).

#### Authentication — **v3: none (user decision)**

**Decision: no application-level authentication for the prototype phase.** This is a single-user
personal tool that is not intended to be shared or publicly distributed. There is no login screen, no
session, no auth middleware, and no identity concept anywhere in the system. `/settings` — or a
deploy-time control such as Vercel's deployment protection — is the only gate.

Concretely, relative to v2: the Google OAuth / Auth.js (NextAuth v5) decision is **withdrawn**;
`src/app/(auth)/login/page.tsx`, `src/lib/auth.ts`, and the auth middleware are removed from the
plan; the `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_ALLOWED_EMAIL` and `AUTH_URL`
env vars are removed from § Environment. The v1 single-passcode fallback stays rejected and is not
revived — "no auth" was chosen over it, not instead of the OAuth option only.

**The trade-off, stated plainly.** A Vercel deployment is a public URL by default. With zero
application auth, **anyone who has or guesses that link can read the user's real portfolio: holdings,
cost basis, valuations, and P/L.** There is no rate limit, no logging of who read what, and no way to
revoke access short of taking the deployment down or adding auth back. Vercel URLs are not secret in
any cryptographic sense — production deployment hostnames are derived from the project name, and
deployment URLs appear in TLS certificate-transparency logs — so "nobody knows the URL" is a weak
assumption, not a control. This is the user's explicit call and it is recorded as made; the point of
writing it down is that the exposure is visible to whoever reads this spec next, including a future
session that might otherwise assume a session boundary exists.

> **Recommended mitigation — non-blocking, does not gate implementation.** Two cheap options, either
> of which restores most of the protection without any application code:
> 1. **Vercel deployment protection** (Vercel Authentication / password protection on the project),
>    which gates the deployment at the platform edge before a request reaches the app. This is
>    configuration the user sets in the Vercel dashboard — no code, no env var, no dependency.
> 2. **Do not promote to production**: keep the app on a preview deployment and treat its URL as
>    private, sharing it with nobody.
>
> Neither is a substitute for real auth. **If this app is ever shared with another person, exposed on
> a custom domain, or used from an untrusted network, application-level authentication must return
> first** — at which point the v2 design above (Google OAuth + single-email allowlist via Auth.js) is
> the recorded starting point and can be restored from this document's history.

> The agent does **not** create accounts, enter credentials, provision OAuth clients, or change the
> user's Vercel project settings. Any mitigation above is performed by the user.

#### Environment

`.env.sample` gains the following. **The agent writes `.env.sample` only and never reads or writes
`.env`.** None carries a `NEXT_PUBLIC_` prefix, so none is inlined into the client bundle.

| Variable | Required | Purpose | Notes |
|----------|:--------:|---------|-------|
| `DATABASE_URL` | yes | Neon Postgres connection string | pooled connection string; user-provisioned |
| `CRON_SECRET` | yes | bearer token for `POST /api/jobs/daily-briefing` (ADR-0003) | high-entropy random; **still required in v3** — it is the only guard left on the one endpoint that spends provider quota. Must not be publicly guessable or anyone can burn the daily Gemini quota. |
| `GEMINI_MODEL` | yes | which Gemini model generates the briefing | **default `gemini-3.6-flash`** — see the verification note below |
| `TZ` | recommended | `Asia/Seoul` | belt-and-braces; date logic must not depend on it (§ Cross-platform) |
| `BRIEFING_LANG` | no | briefing output language, default `ko` | see § Accessibility; changing it also changes the document `lang` attribute |

The 8 provider secrets already in `.env.sample` (`KRX_API_KEY`, `DART_API_KEY`, `ECOS_API_KEY`,
`FINNHUB_API_KEY`, `FMP_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `GEMINI_API_KEY`) are
unchanged in v3.

> **Removed in v3**: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_ALLOWED_EMAIL`,
> `AUTH_URL`. They must not appear in `.env.sample`. The complete v3 list is therefore
> **`DATABASE_URL`, `CRON_SECRET`, `GEMINI_MODEL`, `TZ`, `BRIEFING_LANG`** plus the 8 provider
> secrets — 13 variables, of which `TZ` and `BRIEFING_LANG` are optional.

> ⚠️ **`GEMINI_MODEL` default is unverified (Q5).** The user specified "gemini 3.6 flash" and
> `gemini-3.6-flash` is recorded as the default accordingly. **I have no way to verify that this
> exact model-id string exists in Google's current Gemini API model catalog** — no network
> verification was performed for this design. The implementer must check the id against Google's
> published model list at implementation time and correct the default if it differs. This is
> deliberately low-cost to get wrong: per ADR-0002/ADR-0003 the model id is read from the environment
> and never hardcoded, and the resolved value is recorded on every `briefing` row (`briefing.model`),
> so a wrong default is a one-line env change and is visible in the data afterwards. That property is
> confirmed unchanged in v2.

---

### Accessibility

Mandatory per `docs/context.md § Accessibility Standards` — this is user-facing software.

- **Target**: WCAG 2.1 Level AA, evaluated additionally against the 7 Universal Design principles.
- **Affected interaction areas**: touch (primary — mobile-first), keyboard, screen reader, contrast,
  motion.
- **Baseline requirements carried into the UI spec**:
  - **Colour convention — finalized (Q4 confirmed): Korean convention app-wide, `up = red`,
    `down = blue`.** One convention for both KRX and US holdings; no per-market switching, because
    the same colour meaning two different things on one screen is a correctness hazard, not a
    localization nicety. The `tokens.json` semantic layer therefore needs role tokens named for
    *meaning* (`--color-value-up` / `--color-value-down`), never for hue, so the convention lives in
    one place.
  - **Gain/loss must never be conveyed by colour alone.** Non-negotiable, and it is what makes the
    single-convention choice safe: every P/L value pairs its colour with an explicit sign (`+`/`−`)
    **and** a direction arrow, and exposes the direction in words in its accessible name. Colour is
    reinforcement only — the figure must remain fully readable in greyscale, for a red-green or
    blue-yellow colour-vision deficiency, and to a screen reader. WCAG 1.4.1.
  - **Estimated quantities must be marked (v2 / ADR-0004).** `quantity_basis = 'estimated'` is
    information, not decoration: it must appear as text or an icon with an accessible name, never as
    colour, opacity, or italics alone. A share count back-derived from 평가금액 ÷ close must never be
    presentable as a broker-reported fact.
  - **Transaction form (v2 / ADR-0004)**: numeric inputs use `inputmode="decimal"` with explicit
    `<label>` association; validation errors are programmatically associated and state the correction
    (the over-sell rejection names the current quantity — WCAG 3.3.1/3.3.3); the date field accepts
    keyboard entry and does not require a pointer-driven picker; voiding a transaction has a
    keyboard-reachable, keyboard-dismissible confirm step that returns focus to its originating
    control.
  - Touch targets ≥ 44×44 CSS px; primary actions reachable one-handed in the lower screen area.
  - Visible focus on every interactive element; no keyboard traps in the upload flow.
  - Contrast ≥ 4.5:1 for text and ≥ 3:1 for UI components, verified against `tokens.json` semantic
    tokens in **both** themes (the token file already defines light/dark primitives).
  - Numeric tables use real `<table>` semantics with scoped headers, not styled `<div>`s, so a
    screen reader can navigate the holdings grid.
  - `prefers-reduced-motion` respected for any sparkline/transition.
  - **Language — finalized (Q5 confirmed): the briefing is written in Korean.**
    `<html lang="ko">` is the primary document language for the whole app. English tickers, company
    names, and any genuinely English passage (a quoted English headline, an English source summary)
    carry a per-element `lang="en"` so a screen reader switches voice for that span and back
    afterwards. The storage model already supports this: `news_item.lang` is captured at ingest, so
    the renderer knows which passages are which rather than guessing. Do **not** wrap a bare ticker
    like `SMPL` inside a Korean sentence in `lang="en"` reflexively — mark passages, not tokens,
    except where a screen reader would otherwise mispronounce a whole name.
  - The briefing is long-form text: correct heading hierarchy per holding so a screen-reader user can
    skip between positions rather than reading linearly.
- **Verification**: the `accessibility-audit` skill (axe-core, WCAG 2.1 AA) against the **six**
  screens (v2 adds `/transactions`), plus a manual keyboard + screen-reader pass on the upload flow
  and on the add-transaction flow including its error states. Design conformance additionally
  gated by `token-usage-lint` (no raw hex/px bypassing `tokens.json`).

---

### Computational Integrity

Per `docs/context.md § Computational Integrity Standards`, portfolio valuation is regulated-finance-
adjacent arithmetic that is *reported to and acted on by* the user:

- Money and quantities are stored as Postgres `numeric` and handled in TypeScript via a decimal
  library — **never** as IEEE-754 `number`. `src/lib/money.ts` is the only place arithmetic happens,
  including the `current_holding` fold (v2), whose running average-cost division is exactly the kind
  of repeated operation where float drift accumulates.
- **Derived figures must be labelled as derived (v2).** Because the export carries no share count,
  some displayed quantities are back-derived rather than reported. `quantity_basis` travels with
  every position from the query all the way to the rendered element, and the UI must distinguish
  "the broker says you hold this many" from "we calculated this from a value and a price". Presenting
  an estimate with the authority of a broker statement would be a computational-integrity failure
  even though every individual arithmetic step is exact.
- The exact, provider-free figures are `market_value_at_upload − cost_basis_total` at the snapshot
  instant. Anything repriced after `as_of_date` inherits the uncertainty of the derived quantity.
  Where the two disagree, the UI shows the snapshot figure with its as-of date rather than hiding the
  discrepancy.
- Every displayed figure (position value, P/L, weight, FX-converted totals) is computed by executed
  code, never by the LLM and never by an agent doing arithmetic in prose.
- **The Gemini model is explicitly forbidden from computing or restating numbers.** The prompt
  supplies pre-computed figures as data and instructs the model to reference them verbatim; the
  structured-output schema has no free numeric fields. Any number in the briefing UI is rendered
  from the database row, not from model text.
- The app presents data and summaries; it does **not** generate investment advice or
  recommendations. The briefing prompt must carry an explicit instruction to describe and
  contextualize rather than advise, and the UI should carry a plain disclaimer.

---

### Screen inventory (input to the designer agent, not a UI spec)

| Screen | Route | Primary job |
|--------|-------|-------------|
| Today's Briefing | `/` | Overnight market/macro overview, then one card per holding with news-backed narrative |
| Portfolio | `/portfolio` | Current holdings (snapshot ⊕ manual transactions) grouped KR/US, value, weight, P/L, FX-normalized total, `estimated` markers |
| Holding detail | `/holdings/[id]` | Position, price history, linked news & disclosures, **"adjust" entry point into the transaction form** |
| **Transactions** *(new in v2)* | `/transactions` | List manual adjustments (active + superseded), add/edit buy/sell/set-quantity/remove, void. **The form exposes `transaction_date` as an editable date field** — it is pre-filled with today (Asia/Seoul) for convenience but the user can set any date, including a back-dated one, because a trade is frequently recorded after the fact and `transaction_date` is the ordering and supersession key (ADR-0004 §3–§4), not a bookkeeping timestamp. Keyboard-enterable, no pointer-only picker (§ Accessibility). |
| Upload | `/upload` | Pick file → confirm `as_of_date` → parse preview + diff vs. **current holdings** + list of transactions this commit will supersede → resolve unknown labels → commit |
| Settings / Health | `/settings` | Last job run, per-provider status, manual regenerate. **v3: no sign-out — there is no session** (§ Authentication) |

---

### Acceptance criteria

- [ ] `bun run build` succeeds with `strict` TypeScript and zero type errors.
- [ ] A build-time (or test-time) assertion proves no provider secret name appears in any
      client-side bundle, and no provider env var is `NEXT_PUBLIC_`-prefixed.
- [ ] A client component importing `providers/gateway.ts` or `db/index.ts` fails the build.
- [ ] Uploading a Samsung Securities export creates exactly one `portfolio_snapshot`; uploading the
      identical file again is rejected as a duplicate (`file_sha256`) without creating a second.
- [ ] The parser reads `docs/benchmark-fixtures/samsung-securities-sample.xlsx` and produces 6 rows
      with the canonical fields `raw_label`, `currency`, `market_value`, `cost_basis_total`.
- [ ] KRW rows resolve as KRX securities and USD rows as US securities **from the `통화` column
      alone**; unresolvable labels surface in the preview and are never silently dropped.
- [ ] `가나전자우` and `가나전자` in the fixture resolve to **two distinct** `security` rows — the
      Korean preferred-share `우` suffix is not normalized away.
- [ ] `SMPL.B` is not split on the `.`; `ZZTEST ETF` (whitespace, zero valuation) does not cause a
      divide-by-zero in the quantity derivation and is surfaced rather than dropped.
- [ ] Money values round-trip through parse → store → display with no floating-point drift; unit
      tests cover KRW (integer-like) and USD (2-dp) plus a fractional-share quantity.
- [ ] The daily job is idempotent: running it twice for the same date performs **at most one**
      Gemini call and leaves exactly one `briefing` row.
- [ ] If any single non-Gemini provider fails, the job still completes with `status='partial'`, the
      failed provider listed in `degraded_sources`, and the UI shows which data is stale.
- [ ] Every page view renders with **zero** outbound provider calls (assert `provider_call_log` is
      unchanged across a page-load test).
- [ ] `POST /api/jobs/daily-briefing` returns 401 without a valid `CRON_SECRET` bearer token.
      *(v3: the "or user session" half is removed with the session.)*
- [ ] **v3 — no auth surface exists**: the build contains no login route, no auth middleware, no
      `src/lib/auth.ts`, and no `AUTH_*` variable in `.env.sample` or in any code path.

**Manual adjustments (v2 / ADR-0004)**

- [ ] **Manually adding a buy updates the displayed holdings immediately, with no new upload** — the
      Portfolio screen's quantity, cost basis, and value all change, and the security appears even if
      it was absent from the latest snapshot.
- [ ] A manual sell reduces quantity and relieves cost basis proportionally at the average cost
      *before* that transaction; selling the whole position leaves quantity 0 and cost basis 0.
- [ ] A sell exceeding the current quantity is rejected at write time with an error naming the
      current quantity; no partial write occurs.
- [ ] The transaction form accepts a **user-supplied `transaction_date`**, not only today's date: a
      back-dated buy is stored with the date entered and is folded in that order, and a transaction
      dated on or before the latest snapshot's `as_of_date` is correctly treated as superseded rather
      than applied.
- [ ] Editing a transaction updates the position and bumps `updated_at`; "deleting" one sets
      `voided_at` and removes it from `current_holding` while **leaving the row in the table**.
- [ ] Transactions dated on or before a newly-committed snapshot's `as_of_date` are marked
      `superseded_by_snapshot_id` in the **same** transaction as the snapshot insert, stop affecting
      `current_holding`, and remain queryable in the superseded history. **No trade is counted
      twice** across the reconciliation boundary — asserted by a test that buys, then uploads a
      snapshot already containing that buy, and checks the total is not inflated.
- [ ] Transactions dated **after** the new snapshot's `as_of_date` survive the upload and still apply.
- [ ] A position whose quantity was back-derived reports `quantity_basis = 'estimated'`; applying a
      `set_quantity` transaction flips it to `'exact'`.
- [ ] When `price_daily` for the snapshot's `as_of_date` is missing or zero, the position falls back
      to the frozen as-of value marked stale, its manual transactions are listed separately, and no
      incorrect merged total is displayed.
- [ ] The daily briefing job picks up a security that exists **only** because of a manual buy.
- [ ] All arithmetic in the `current_holding` fold round-trips without floating-point drift, verified
      for KRW (integer-like) and USD (2-dp) plus a fractional-share quantity.

- [ ] All **six** screens pass the `accessibility-audit` skill at WCAG 2.1 AA; P/L direction is
      conveyed by sign + arrow + accessible name, not colour alone, under the Korean
      up = red / down = blue convention; `estimated` quantities carry a non-colour-only marker.
- [ ] The document is `lang="ko"`; genuinely English passages in the briefing carry `lang="en"`.
- [ ] `token-usage-lint` reports no hardcoded hex/rgb/px values in `src/components/**`.
- [ ] `bun scripts/audit.ts` exits 0 and `gitleaks` reports no findings.
- [ ] `docs/co-develop.context.md` Tech Stack table contains no remaining `[e.g., ...]` placeholders.

---

### Open questions

All seven v1 questions were answered. Two follow-ups remain, neither blocking.

#### Resolved

- **Q1 — Samsung Securities export format. ✅ ANSWERED — see fixture.** The user supplied a real
  export; it was analyzed structurally (headers, column order, cell types, sheet layout only) and a
  **redacted** fixture committed at
  [`docs/benchmark-fixtures/samsung-securities-sample.xlsx`](../benchmark-fixtures/samsung-securities-sample.xlsx)
  with its redaction statement in
  [`samsung-securities-sample.md`](../benchmark-fixtures/samsung-securities-sample.md). Format:
  `.xlsx`, one sheet, header row 1, **four columns** — `종목명`, `통화`, `평가금액`, `매수금액`. KRX
  and US rows are distinguished by the `통화` column (`KRW`/`USD`); there are no separate sheets and
  no section headers. Full mapping in § Parser profile. The consequential finding is what the file
  does **not** contain: no quantity, no per-share price, no ticker code, no ISIN, no as-of date, no
  account identifier. That drove the value-based position model and the derived-quantity mechanism.
  *(The original `export_sample.xlsx` remains untouched at the project root. It contains the user's
  real financial data; **PM should decide whether to gitignore or remove it before the first
  commit** — this design references only its structure, never its contents.)*
- **Q2 — Hosting. ✅ CONFIRMED.** Vercel Hobby is acceptable; usage is personal and non-commercial.
  No design change. ADR-0001 stands as written.
- **Q3 — Auth. ✅ ANSWERED, then REVERSED BY THE USER IN v3 — there is no application-level auth.**
  v2 recorded Google OAuth with a single-email allowlist (Auth.js). In v3 the user decided this
  single-user prototype will not be shared and does not need it, so the whole layer is removed:
  no login screen, no session, no middleware, and no `AUTH_*` env vars. The v3 env list is
  `DATABASE_URL`, `CRON_SECRET`, `GEMINI_MODEL`, plus optional `TZ` and `BRIEFING_LANG`, plus the 8
  provider secrets. The accepted risk — a reachable URL exposes real portfolio data — and the
  recommended non-blocking mitigations (Vercel deployment protection, or keeping it a private
  preview) are recorded in § Authentication. The v1 passcode fallback remains rejected.
- **Q4 — Colour convention. ✅ CONFIRMED — Korean convention app-wide (up = red, down = blue)**,
  always paired with sign + arrow + accessible name so colour is never load-bearing. Finalized in
  § Accessibility, including the requirement that the semantic tokens be named for meaning, not hue.
- **Q5 — Gemini model + briefing language. ✅ ANSWERED.** Briefing language **Korean**, with
  `lang="ko"` as the document language and per-passage `lang="en"` for genuinely English passages
  (§ Accessibility). `GEMINI_MODEL` default recorded as **`gemini-3.6-flash`** — see the explicit
  verification caveat in § Environment; the id is env-configurable and recorded per briefing, so a
  wrong default is cheap to correct.
- **Q6 — Upload cadence / staleness. ✅ ANSWERED — and it changed the design.** The user will not
  re-export per trade. Manual buy/sell entry is now a first-class feature: new `manual_transaction`
  table, new `current_holding` computation, new `/transactions` screen, two new API routes, new
  acceptance criteria. Recorded as [ADR-0004](../adr/0004-manual-holding-adjustments.md).
- **Q7 — KRX provider scope. ✅ DELEGATED to architect judgment; assumption retained and now
  labelled.** The design assumes the user's KRX Open API key grants **daily OHLC for listed equities
  the user holds**. ⚠️ **This is an architect-made assumption under the user's delegation, not a
  confirmed fact** — no verification against the KRX service catalog or the user's key permissions
  was performed. It **must be verified against the actual key's authorized endpoints at
  implementation time.** v2 raises the stakes: because the export has no quantity, the KRX close
  price is an input to the *position* and not only to its display (§ Provider integration matrix), so
  a scope mismatch degrades more than a number on screen. Mitigation if the assumption is wrong: KRX
  prices are consumed only through `src/lib/providers/krx.ts` behind the gateway, so swapping the
  endpoint (or substituting another source) is a single-file change with no schema impact.

#### Still open (non-blocking)

- **Q1-b — Is the supplied sample a raw brokerage download or a hand-prepared extract?** The
  evidence points to hand-prepared (see the architect note in § Parser profile). If the user has a
  **raw, unedited** Samsung Securities download, supplying it — redacted the same way — is the
  single highest-value remaining input: a share-count or ticker-code column would eliminate the
  derived-quantity mechanism, remove its estimation error, and simplify security resolution. This is
  non-blocking because the design works with the file as given and the parser profile is versioned
  data; a richer export becomes `samsung-securities/v2` with no parser code change.
- **Q1-c — Cash and non-equity positions.** The sample contains only securities. Deposits, foreign-
  currency cash, bonds, and funds are out of scope in v1 by omission rather than by decision. Worth
  confirming that a portfolio total excluding cash is what the user wants to see.

---

*Next step after approval: the **designer** agent produces `docs/specs/0002-portfolio-pulse-ui-spec.md`
from the screen inventory (**six** screens as of v2) and accessibility requirements above — including
the confirmed Korean colour convention, the `estimated`-quantity marker, and the transaction form's
error-state requirements — then **code-writer** implements against this plan. Per `[DEVELOP-R1]`,
`security-monitor` reviews before the first PR.*

*Two items PM should route before implementation: (1) decide the disposition of the root
`export_sample.xlsx`, which holds real financial data and is currently untracked but not ignored;
(2) put Q1-b to the user — a raw, unedited brokerage download would remove the derived-quantity
mechanism entirely.*
