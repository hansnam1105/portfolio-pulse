# ADR-0004: Manual holding adjustments are an append-only transaction layer over the snapshot, not edits to it

- **Status**: Proposed
- **Date**: 2026-09-08
- **Deciders**: architect (pending user approval)
- **Related**: [spec 0001](../specs/0001-portfolio-pulse-system-design.md),
  [ADR-0001](0001-tech-stack-nextjs-vercel-postgres.md),
  [ADR-0002](0002-server-side-provider-gateway.md),
  [ADR-0003](0003-precomputed-daily-briefing-snapshot.md)

---

## Context

ADR-0003 and spec 0001 defined "my current portfolio" as *the holdings of the most recent
`portfolio_snapshot`*. That definition is only correct at the instant of upload. Between uploads,
any trade the user makes is invisible to the app, and the only remedy on offer was "upload a fresh
brokerage export". The user has stated that this is unacceptable: they want to record a buy or a
sell directly in the app and see the portfolio stay correct, without producing a new export every
time.

Three constraints shape the answer:

1. **The append-only snapshot must survive.** It is what gives safe re-uploads, file-hash
   idempotency, position history, and trivial rollback (spec 0001 § Design principle). Making
   `holding` rows mutable so the user can "edit a holding" would destroy all four properties at
   once, and would mean a re-upload silently overwrites the user's manual work.
2. **The snapshot is authoritative but periodic; manual entries are timely but unverified.** These
   are different epistemic classes of data and must not be stored in the same table, or the app
   loses the ability to say which figures came from the broker.
3. **The real export carries no quantity.** Analysis of the user-supplied sample (Q1, see spec 0001
   § Parser profile) shows four columns only — security name, currency, valuation amount, cost
   amount. There is no share count and no per-share price. A manual transaction, by contrast, is
   naturally expressed in shares and price. The merge therefore has to reconcile a **value-based**
   position with a **quantity-based** adjustment, which is the hard part of this decision and was
   not visible when spec 0001 was written.

## Decision

**Add a second append-only table, `manual_transaction`, and redefine "current holdings" as a
computed function of the latest snapshot and the manual transactions that post-date it. Nothing is
ever edited in place; nothing is ever deleted by the system.**

### 1. `manual_transaction` is append-only, like the snapshot

```
manual_transaction
  id                    pk
  security_id           fk -> security
  kind                  enum('buy','sell','set_quantity','remove')
  quantity              numeric(24,8)?   -- required for buy/sell/set_quantity
  price                 numeric(24,8)?   -- per-share, transaction currency; required for buy/sell
  fees                  numeric(24,8) default 0
  cost_basis_total      numeric(24,8)?   -- optional override, used with set_quantity
  currency              enum('KRW','USD')
  transaction_date      date             -- Asia/Seoul calendar date; the ordering key
  note                  text?
  created_at            timestamptz
  updated_at            timestamptz
  voided_at             timestamptz?     -- user "delete" = soft void, never a row removal
  superseded_by_snapshot_id  fk -> portfolio_snapshot ?   -- set at reconciliation (§4)
```

A user "edit" writes a new `updated_at` and keeps the row id; a user "delete" sets `voided_at`. The
row never leaves the table, so the audit trail behind a number the user acted on financially is
always reconstructible. This is the same principle as the snapshot table, applied to the second
data source.

### 2. `portfolio_snapshot` gains an explicit `as_of_date`

The export contains no date column, so the snapshot's own effective date has to be established at
commit time rather than parsed. `portfolio_snapshot.as_of_date` (an Asia/Seoul calendar date)
defaults to the upload date and is user-editable in the upload confirm step — a user who exports on
Monday and uploads on Wednesday must be able to say so, because this date is the boundary that
decides which manual transactions still apply.

`as_of_date`, not `uploaded_at`, is the comparison key. Comparing a `date` against a `timestamptz`
would make the result depend on the upload's clock time, which is not a meaningful distinction here.

### 3. Current holdings: the exact computation

Defined as a database view `current_holding` (materialization is an optimization decision, not part
of this ADR). Per security, all arithmetic in the security's native currency, via
`src/lib/money.ts` decimal helpers — never IEEE-754 floats:

```
Let S    = the latest portfolio_snapshot
    H    = S's holding row for this security (may be absent for a newly-bought security)
    T    = manual_transaction rows for this security where
             transaction_date > S.as_of_date
             AND voided_at IS NULL
             AND superseded_by_snapshot_id IS NULL
           ordered by (transaction_date, created_at)

Base leg (from the export):
  c_base = H.cost_basis_total                        -- 매수금액, exact
  q_base = H.quantity                                 if the parser profile supplies quantity
         = H.market_value_at_upload
           / price_daily(security, S.as_of_date)      otherwise   [ESTIMATED]
         = 0                                          if H is absent

Apply T in order, maintaining (q, c) starting from (q_base, c_base):
  buy           q += t.quantity ;  c += t.quantity * t.price + t.fees
  sell          q -= t.quantity ;  c -= t.quantity * (c / q)      -- proportional cost relief
                                                                   -- (avg cost BEFORE this row)
  set_quantity  q  = t.quantity ;  c  = COALESCE(t.cost_basis_total, c)
  remove        q  = 0          ;  c  = 0

Result:
  quantity_current = q
  cost_basis       = c
  value_current    = q * latest_close(security)        -- × FX when displayed in KRW total
  unrealized_pl    = value_current - cost_basis
```

**`quantity_basis` is carried alongside every position** as `'exact' | 'estimated'`:

- `'exact'` when `q_base` came from the export itself (a future richer parser profile), or when a
  `set_quantity` transaction has been applied — a `set_quantity` row therefore *upgrades* a position
  from estimated to exact, which is the intended remedy for the quantity-less export.
- `'estimated'` otherwise, i.e. quantity was back-derived from 평가금액 ÷ close price.

The UI must render `'estimated'` positions with a visible, non-colour-only marker and must not
present a derived share count as if the broker reported it.

**Degenerate cases are explicit, not incidental:** if `price_daily` for `as_of_date` is missing or
zero, `q_base` is undefined — the position falls back to displaying the snapshot's 평가금액 as a
frozen "as of `as_of_date`" figure, marked stale, and manual transactions for it are shown as a
separate un-merged list rather than silently producing a wrong total. A `sell` that would drive
`q` below zero is rejected at write time with a validation error naming the current quantity.

### 4. Reconciliation on a new upload: supersede, retain, never delete

When snapshot `S_new` is committed, every non-voided `manual_transaction` with
`transaction_date <= S_new.as_of_date` and no existing supersession has
`superseded_by_snapshot_id = S_new.id` set, inside the same transaction as the snapshot insert.

Those rows stop contributing to `current_holding` (they fall out of set `T` by both the date filter
and the supersession filter) but remain queryable, and the Portfolio screen keeps a "superseded
adjustments" history view.

**Rejected alternative: keep superseded transactions active.** It double-counts. A buy made on the
5th and then reflected in a broker export dated the 10th would be added twice — once inside the
export's 평가금액/매수금액, once as a live adjustment. Silent double-counting of a position value
is the worst available failure for this app.

**Rejected alternative: hard-delete on supersession.** It destroys the record of what the user
believed and acted on between exports, and it makes a mistaken `as_of_date` unrecoverable. Retention
costs a handful of rows.

Supersession is reversible: rolling back to a prior snapshot clears the
`superseded_by_snapshot_id` values that snapshot set, restoring the adjustments.

### 5. Surface area

- New screen `/transactions` (list + add/edit form), plus an "adjust" entry point on
  `/holdings/[securityId]` — the natural place to record a trade is next to the position.
- New session-guarded routes: `POST/PATCH /api/transactions` and `DELETE /api/transactions/[id]`
  (soft void). Consistent with ADR-0002: these touch only this app's own database and make no
  outbound provider call, so they add no key-exposure surface.

  > **Cross-reference — amended by spec 0001 v3 (2026-09-08).** Application-level authentication was
  > removed at the user's explicit direction, so these routes are **not** session-guarded; no session
  > exists. The ADR-0002 property quoted above is the one that mattered here and it still holds:
  > these routes make no outbound provider call, so removing the session adds no *key*-exposure
  > surface. It does mean anyone who can reach the deployment can write a manual transaction — an
  > accepted risk recorded in spec 0001 § Authentication. The data-model decision in this ADR is
  > unchanged.
- The daily briefing job (ADR-0003) reads its security list from `current_holding` rather than
  directly from the latest snapshot, so a stock bought manually yesterday is covered by tomorrow's
  briefing without waiting for an export. This is the only change ADR-0003 requires and it does not
  alter its decision.

## Consequences

**Positive**

- The portfolio stays correct between exports, which was the user's actual requirement. Uploads
  become a periodic *reconciliation* rather than the only way to record reality.
- Provenance is preserved end to end: every displayed figure traces to either a broker export row
  or a specific manual transaction, and the UI can say which.
- Re-uploads remain non-destructive and idempotent. ADR-0003's append-only property is untouched;
  this layer is strictly additive.
- `set_quantity` gives the user a way to fix the export's most damaging omission (no share count)
  once per position, permanently upgrading that position to exact repricing.
- The briefing automatically covers newly-bought securities.

**Negative / risks**

- **Derived quantity is an estimate and can be wrong.** Fractional-share rounding, an
  intraday-priced export, a missing close price, or a stock split between `as_of_date` and today all
  distort `q_base`. Mitigated by the `quantity_basis` marker, the `set_quantity` remedy, and the
  refusal to silently produce a total when the derivation is impossible. Not eliminated.
- **Corporate actions are out of scope in v1.** A split or a stock dividend invalidates both the
  derived quantity and any manual quantity until the next export. Documented as a known limitation
  with the next export as the correction mechanism; a `corporate_action` table is deliberately
  deferred.
- **`current_holding` is materially more complex than "the latest snapshot's rows"** — an ordered
  fold with a running average-cost calculation rather than a select. It requires its own unit-test
  suite covering ordering, over-sell rejection, supersession boundaries, and the missing-price
  fallback.
- **The user can now enter wrong data**, and the app cannot validate it against the broker. The
  upload preview partly compensates by showing the diff between computed current holdings and the
  incoming export, surfacing drift at reconciliation time.
- **Scope grows**: one table, one column on an existing table, one view, one screen, two routes, and
  the test suite for the fold. Spec 0001 is already flagged HIGH risk; this widens it.
- An `as_of_date` the user sets incorrectly mis-partitions the transactions. Mitigated by defaulting
  it to the upload date, showing the resulting supersession list *before* commit, and by the
  reversibility in §4.

## Platform Impact

| Platform | Impact | Files Affected |
|----------|--------|----------------|
| Claude Code | **No governance change.** This is an application data-model decision. It adds no hook, slash command, agent, or dispatch rule, and introduces no new environment variable or secret (the manual-transaction layer is entirely internal to the app's own database and makes no outbound call). `CLAUDE.md` is unchanged; the affected artifacts are the application schema and spec, which agents read via `docs/co-develop.context.md` and spec 0001. | `docs/specs/0001-portfolio-pulse-system-design.md` (data model, screens, acceptance criteria) |
| Antigravity (GEMINI.md) | **None — justified.** `GEMINI.md` governs AI-tooling behavior: Antigravity tool mapping, subagent dispatch, model tiers, hook parity. This decision changes none of those. It is a schema and computation decision inside the application, read by every platform from the shared, platform-neutral spec. Restating it in `GEMINI.md` would create a second source of truth for the position algebra — precisely the divergence the one-directional inheritance rule exists to prevent. | N/A |
| templates/common | **None — this is a leaf project, not a workspace template.** No propagation path exists from `Projects/portfolio-pulse` into `templates/common`. If this app is later promoted to a variant, the `project-to-variant` skill decides propagation at that time, not this ADR. | N/A |

## Accessibility Impact

**Direct** — this decision adds a data-entry screen, the app's first genuinely interactive form, and
introduces a new class of uncertain value that must be communicated.

- **Target**: WCAG 2.1 Level AA, consistent with spec 0001.
- **Affected interaction areas**: form input, touch, keyboard, screen reader, error identification.
- The `estimated` vs `exact` quantity distinction is **information, not decoration**. It must be
  conveyed as text or an icon with an accessible name — never by colour, opacity, or italics alone
  (WCAG 1.4.1). A user who cannot perceive the marker would otherwise read a back-derived share
  count as a broker-reported fact.
- The buy/sell direction in the transaction list is subject to the same rule as P/L: sign plus
  label, never colour alone. Under the confirmed Korean colour convention (spec 0001 Q4) a buy is
  not inherently red or blue, so the label is the primary carrier and colour is at most reinforcement.
- Numeric inputs (quantity, price) need `inputmode="decimal"`, explicit `<label>` association,
  programmatically associated error messages (WCAG 3.3.1/3.3.3), and error text that states the
  correction — e.g. the over-sell rejection must name the current quantity, not just say "invalid".
- The date field must accept keyboard entry, not require a pointer-driven date picker.
- Destructive actions (void a transaction) require a confirm step reachable and dismissible by
  keyboard, with focus returned to the originating control.
- The transaction list is tabular data and uses real `<table>` semantics with scoped headers.
- Touch targets ≥ 44×44 CSS px; the form's primary action sits in the one-handed reach zone.
- **Verification**: the `accessibility-audit` skill (axe-core, WCAG 2.1 AA) against `/transactions`
  and the adjusted `/holdings/[securityId]`, plus a manual keyboard and screen-reader pass over the
  add-transaction flow including its error states.
