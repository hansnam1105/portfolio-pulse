# 0002 — portfolio-pulse UI Spec (alpha)

- **Version**: 1 (alpha — visual direction for user review, ahead of implementation)
- **Status**: Proposed — awaiting user reaction to the visual alpha
  ([`docs/mockups/alpha-v1.html`](../mockups/alpha-v1.html))
- **Author**: visual-designer
- **Date**: 2026-09-08
- **Depends on**: [`0001 System Design v3`](0001-portfolio-pulse-system-design.md)
  (§ Screen inventory, § Accessibility, § Computational Integrity),
  [ADR-0004](../adr/0004-manual-holding-adjustments.md), [`docs/design.md`](../design.md), `tokens.json`
- **Scope**: 4 of the 6 screens — `/`, `/portfolio`, `/holdings/[id]`, `/transactions`.
  `/upload` and `/settings` are **deferred to the next design round** (Open Question OQ-1).
- **Not in scope**: no login, no session, no account UI anywhere — spec v3 removed application-level
  authentication entirely.

---

## 1. Foundations

### 1.1 Viewport and layout

Mobile-first, per `docs/co-develop.context.md`. The design target is a 390 × 844 CSS-px viewport;
everything below is specified at that width and reflows up.

| Region | Height | Contents |
|--------|--------|----------|
| App bar | 56px, sticky top | Screen title (`h1`), as-of date, stale-data pill when `degraded_sources` is non-empty |
| Content | fills | Scrolls under the app bar |
| Tab bar | 64px, fixed bottom, `env(safe-area-inset-bottom)` padding | 4 primary destinations |

Primary actions sit in the lower third (thumb zone) per spec § Accessibility. The tab bar is the
only global navigation; there is no drawer and no profile menu (no auth).

### 1.2 Type scale

Body face is the platform Korean UI stack for the alpha (`docs/design.md` § Deferred). All figures
use `font-variant-numeric: tabular-nums` — mandatory, since money appears in aligned columns.

| Role | Size | Weight | Use |
|------|------|--------|-----|
| Display figure | 2rem | 700 | Total portfolio value |
| Title | 1.25rem | 700 | `h1`, card headline |
| Body | 1rem | 400 | Briefing prose |
| Row figure | 1rem | 600 | Holding value, P/L |
| Caption | 0.8125rem | 400/600 | Labels, badges, meta |

### 1.3 Colour roles used by this spec

Consumed as `tokens.json` semantic tokens only; no raw hex in components (`token-usage-lint` gates
this). See [`docs/design.md`](../design.md) for why gain/loss are separate from success/danger.

| Token | Meaning here |
|-------|--------------|
| `--color-value-up` (+ `-bg`, `-border`) | Value rose. Korean convention — **red**. |
| `--color-value-down` (+ `-bg`, `-border`) | Value fell — **blue**. |
| `--color-value-flat` | Exactly 0.00%. |
| `--color-stale` | Price is stale because a provider failed (`degraded_sources`). |
| `--color-estimated` | Quantity is back-derived (`quantity_basis = 'estimated'`). |
| `--color-danger` | A validation error or destructive confirm. **Never** a price movement. |
| `--color-success` | An action succeeded. **Never** a price movement. |

---

## 2. Shared components

Component tokens are not yet written (alpha); these are described behaviourally so the mockup and a
later implementation agree on anatomy.

### 2.1 `PLFigure` — the single most important component

Renders any gain/loss figure. **Every** P/L on every screen goes through it. No screen may render a
signed figure by hand.

**Anatomy**: `[arrow glyph] [sign][amount] [(percent)]` + a visually-hidden direction word.

```html
<span class="pl pl--up">
  <span class="pl__arrow" aria-hidden="true">▲</span>
  <span class="pl__amount">+1,240,000원</span>
  <span class="pl__pct">(+3.24%)</span>
  <span class="sr-only">상승</span>
</span>
```

Rules:
- Direction is carried by **four** channels: arrow glyph, explicit `+`/`−`, colour, and the hidden
  word (`상승` / `하락` / `보합`). Colour is the only removable one.
- Use `−` (U+2212), not a hyphen, so a screen reader reads "minus" and the glyph aligns with `+`.
- Flat (exactly zero) renders `–` (en dash), `--color-value-flat`, hidden word `보합`, and **no** sign.
- The container is `aria-atomic="true"` so the figure is announced as one unit.
- Never `title=`-only, never colour-only, never opacity-only.

### 2.2 `Badge`

Small caption-sized pill, `--*-bg` fill + `--*-border` hairline + `--*` text. Variants used:
`estimated` (`추정 수량`), `stale` (`시세 지연`), `manual` (`수동 조정`), `superseded` (`대체됨`),
`voided` (`취소됨`). Every badge is **text**, never an icon or colour alone — spec § Accessibility
forbids marking an estimated quantity with colour, opacity, or italics alone.

### 2.3 `HoldingRow`

A table row, not a styled `div` — the holdings grid must be a real `<table>` with scoped headers so a
screen reader can navigate it (spec § Accessibility).

Left: name (`lang` per § 5) + ticker/market caption + badges. Right: value (top), `PLFigure` (bottom),
weight caption. Entire row is one link to `/holdings/[id]`; hit area ≥ 44px tall.

### 2.4 `StaleBanner`

Appears in the app bar area whenever the briefing row carries `status='partial'` / non-empty
`degraded_sources`. States which provider failed and which figures are therefore stale, plus the
as-of timestamp of the last good data. `role="status"`, `--color-stale-*`. It is **information, not
an error** — never `--color-danger`.

### 2.5 `Disclaimer`

One line, caption size, muted, present on `/` and `/holdings/[id]`: the app describes and
contextualizes, it does not advise (spec § Computational Integrity). Not dismissible.

---

## 3. Screens

### 3.1 Today's Briefing — `/`

**Job**: the overnight overview, then one narrative card per holding.

**Wireframe (top → bottom)**

```
┌─────────────────────────────────────┐
│ 오늘의 브리핑            9월 8일 (월) │  app bar, h1 + as-of
├─────────────────────────────────────┤
│ ⓘ 시세 지연 — 환율 제공자 응답 없음  │  StaleBanner (conditional)
│   마지막 정상 수집 09-08 06:12       │
├─────────────────────────────────────┤
│  총 평가금액                         │  HeroSummary
│  ₩ 87,432,100                        │  display figure, tabular-nums
│  ▲ +1,240,000원 (+1.44%)  전일 대비   │  PLFigure + comparison label
│  KR 62% · US 38%                     │  allocation caption
├─────────────────────────────────────┤
│ 간밤 시장 요약                        │  h2
│ 미국 증시는 … (Korean prose, lang=ko) │  MarketOverview, 3–5 sentences
├─────────────────────────────────────┤
│ 종목별 브리핑                    5    │  h2 + count
│ ┌─────────────────────────────────┐ │
│ │ 가나전자          ▲ +2.10%      │ │  BriefingCard (h3 per holding)
│ │ 005930 · KRX                    │ │
│ │ 어제 외국인 순매수가 … (prose)   │ │
│ │ ▸ 관련 뉴스 2건 · 공시 1건       │ │  news/disclosure affordance
│ └─────────────────────────────────┘ │
│ … one card per holding …            │
├─────────────────────────────────────┤
│ 본 화면은 정보 제공이며 투자 자문이   │  Disclaimer
│ 아닙니다.                            │
└─────────────────────────────────────┘
     [브리핑] [포트폴리오] [거래] [설정]   tab bar
```

**Components**: `StaleBanner`, `HeroSummary`, `MarketOverview`, `BriefingCard` × n, `PLFigure`,
`Disclaimer`, `TabBar`.

**Heading hierarchy** is load-bearing: `h1` screen → `h2` section → `h3` per holding, so a
screen-reader user skips between positions rather than reading the whole briefing linearly
(spec § Accessibility).

**States**

| State | Presentation |
|-------|--------------|
| Empty (no snapshot yet) | "아직 업로드된 포트폴리오가 없습니다" + primary CTA to `/upload`. No zero-value hero — a `₩0` total would be a false statement. |
| Empty (snapshot, no briefing yet) | Hero renders from the snapshot; briefing section shows "오늘의 브리핑이 아직 생성되지 않았습니다" + last run time. |
| Loading | Skeleton blocks matching final geometry (hero, then 3 cards). No spinner. `aria-busy="true"` on the region; a `role="status"` live region announces once. |
| Error | Section-level, not page-level: the hero still renders from the snapshot even if the briefing fetch failed. `--color-danger`, plain-language cause, retry button ≥44px. |
| Stale data | `StaleBanner` + per-figure `시세 지연` badge on exactly the affected figures. Per spec § Computational Integrity, a stale figure shows the **snapshot value with its as-of date** rather than a silently repriced one. |

**Accessibility notes**: all P/L via `PLFigure` (never colour-only); prose is `lang="ko"` with
`lang="en"` on genuinely English passages only, not on bare tickers (§ 5); disclaimer is real text.

---

### 3.2 Portfolio — `/portfolio`

**Job**: current holdings (snapshot ⊕ manual transactions), grouped KR / US, with value, weight, P/L,
FX-normalized total, and `estimated` markers. Entry point for adding a manual transaction.

**Wireframe**

```
┌─────────────────────────────────────┐
│ 포트폴리오          기준일 09-08 ▾   │  app bar + as-of
├─────────────────────────────────────┤
│ 총 평가금액 (KRW 환산)               │  TotalCard
│ ₩ 87,432,100                         │
│ ▼ −310,500원 (−0.35%)                │
│ 매수금액 ₩ 81,900,000                │
│ 환율 1,382.40원/USD · 09-08 06:12    │  FX basis, always stated
├─────────────────────────────────────┤
│ [ 전체 ] [ 국내 ] [ 해외 ]           │  segmented filter, 44px targets
├─────────────────────────────────────┤
│ 국내 (KRX)              ₩54,200,000 │  group header = <caption>/<th>
│ ┌─────────────────────────────────┐ │
│ │ 가나전자        ₩24,300,000     │ │  HoldingRow
│ │ 005930 · 27.8%  ▲ +1,800,000원  │ │
│ │ [추정 수량]        (+8.00%)     │ │  Badge
│ ├─────────────────────────────────┤ │
│ │ 가나전자우      ₩ 8,150,000     │ │  preferred share — distinct row
│ │ 005935 ·  9.3%  ▼ −240,000원    │ │
│ └─────────────────────────────────┘ │
│ 해외 (US)                $23,980.00 │
│ ┌─────────────────────────────────┐ │
│ │ SMPL.B          $12,410.00      │ │  ticker in lang="en"
│ │ 15.1%  ▲ +$630.00 (+5.35%)      │ │
│ │ ₩17,155,584 환산                 │ │  KRW equivalent, caption
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│        [ + 거래 입력 ]              │  primary FAB-style, thumb zone
└─────────────────────────────────────┘
```

**Components**: `TotalCard`, `SegmentedFilter`, `HoldingsTable` (real `<table>`, one per market
group, `<caption>` naming the group, `scope="col"` headers), `HoldingRow`, `PLFigure`, `Badge`,
`AddTransactionButton`.

The FX rate and its timestamp are **always** visible whenever a converted total is shown — a
converted figure without its rate is unverifiable.

**States**

| State | Presentation |
|-------|--------------|
| Empty | "보유 종목이 없습니다" + two CTAs: 업로드, 거래 직접 입력. |
| Loading | Table skeleton, 5 rows, correct column widths so nothing shifts. |
| Error | Full-screen error only if the holdings query itself failed; otherwise degrade per-row. |
| Stale | Affected rows carry `시세 지연`; the total carries the as-of date and the group subtotal is computed from snapshot values, not from a partial reprice. |
| Estimated quantity | `추정 수량` badge on the row + a footnote linking to the `set_quantity` remedy on the holding detail. |
| Zero-valuation row | A row like a whitespace/zero-value ETF renders with value `—` and a `평가금액 없음` badge; it is **surfaced, never dropped**, and contributes 0 to weight without a divide-by-zero. |

**Accessibility notes**: real table semantics; row link target ≥44px; the `+ 거래 입력` button is in
the lower third and ≥44×44; weight percentages are text, never only a bar width; every P/L via
`PLFigure`.

---

### 3.3 Holding detail — `/holdings/[id]`

**Job**: one position in full — figures, price history, linked news and disclosures, and the
"adjust" entry point into the transaction form.

**Wireframe**

```
┌─────────────────────────────────────┐
│ ‹ 가나전자                           │  back + h1
├─────────────────────────────────────┤
│ ₩24,300,000                          │  PositionHeader
│ ▲ +1,800,000원 (+8.00%)              │
│ 005930 · KRX · 비중 27.8%            │
│ [추정 수량] 300주 (추정)              │  Badge + basis, explicit
├─────────────────────────────────────┤
│ ╭───────────────────────────────╮   │  Sparkline, 30일
│ ╰───────────────────────────────╯   │  respects prefers-reduced-motion
│ 30일   1,300원 ~ 1,470원             │  range as TEXT — chart is not the
│                                     │  only carrier of the data
├─────────────────────────────────────┤
│ 보유 내역                            │  h2 — PositionFacts
│ 평균 단가      ₩81,000 (추정)        │
│ 매수금액       ₩22,500,000           │
│ 기준일         2026-09-08            │
├─────────────────────────────────────┤
│ 관련 뉴스                            │  h2 — NewsList
│ · 가나전자, 3분기 … (한국경제)        │  lang per item (news_item.lang)
│ · Sample Corp raises … (Reuters)     │  lang="en" on this passage
│ 공시                                 │  h2 — DisclosureList
│ · 주요사항보고서 · 09-05             │
├─────────────────────────────────────┤
│  [ 수량 조정 ]   [ 거래 입력 ]        │  adjust entry points, thumb zone
├─────────────────────────────────────┤
│ 정보 제공 목적이며 투자 자문이 아닙니다│  Disclaimer
└─────────────────────────────────────┘
```

**Components**: `PositionHeader`, `Sparkline`, `PositionFacts` (definition list), `NewsList`,
`DisclosureList`, `AdjustButtons`, `Badge`, `PLFigure`, `Disclaimer`.

`수량 조정` opens the transaction form pre-set to `set_quantity` — the remedy that flips
`quantity_basis` from `estimated` to `exact` (ADR-0004 §3). It is placed on this screen because this
is where the estimate is visible.

**States**

| State | Presentation |
|-------|--------------|
| Empty (no news) | "관련 뉴스가 없습니다" — an empty section is stated, not omitted, so absence is distinguishable from a failed fetch. |
| Empty (no price history) | Sparkline replaced by "가격 이력이 없습니다"; the numeric range line is omitted rather than shown as 0. |
| Loading | Header renders first (it comes from the holdings query); news/sparkline stream in with skeletons. |
| Error (news provider failed) | Section shows `뉴스를 불러오지 못했습니다` + retry; the position figures are unaffected and stay visible. |
| Stale | `시세 지연` badge next to the value; the frozen as-of value is shown with its date, and any manual transactions after that date are **listed separately** rather than merged into a possibly-wrong total. |
| Estimated | `추정 수량` badge + "300주 (추정)" in words + inline link to 수량 조정. |

**Accessibility notes**: `Sparkline` is `role="img"` with an `aria-label` stating the range and
direction in words; its numeric range is duplicated as visible text; `prefers-reduced-motion`
disables its draw animation. News items carry per-item `lang`. Heading order `h1 → h2` unbroken.

---

### 3.4 Transactions — `/transactions`

**Job**: the manual buy/sell log (active + superseded + voided) and the add/edit form. **The date
field is a visible, editable, keyboard-enterable input** — ADR-0004 §3–§4 makes `transaction_date`
the ordering and supersession key, so hiding it or pinning it to "now" would be a correctness bug,
not a convenience.

**Wireframe — list**

```
┌─────────────────────────────────────┐
│ 거래 내역                            │
├─────────────────────────────────────┤
│ [ 활성 ] [ 대체됨 ] [ 취소됨 ]       │  segmented filter
├─────────────────────────────────────┤
│ 2026-09-07                          │  date group header
│ ┌─────────────────────────────────┐ │
│ │ 매수  가나전자                   │ │  TransactionRow
│ │ 50주 × ₩81,200 = ₩4,060,000     │ │
│ │ [수동 조정]        [수정] [취소] │ │  ≥44px targets
│ └─────────────────────────────────┘ │
│ 2026-09-02                          │
│ ┌─────────────────────────────────┐ │
│ │ 매도  SMPL.B                     │ │
│ │ 10주 × $124.10 = $1,241.00      │ │
│ │ [대체됨 · 09-08 스냅샷]          │ │  superseded — struck + badge
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│        [ + 거래 입력 ]              │
└─────────────────────────────────────┘
```

**Wireframe — add/edit form** (bottom sheet on mobile, ≥44px controls throughout)

```
┌─────────────────────────────────────┐
│ 거래 입력                        ✕  │
├─────────────────────────────────────┤
│ 종류                                 │
│ [매수] [매도] [수량 지정] [보유 제거] │  4 types, ADR-0004
│                                     │
│ 종목                                 │
│ [ 가나전자                     ▾ ]  │
│                                     │
│ 거래일  ← VISIBLE AND EDITABLE       │
│ [ 2026-09-08            ] 📅        │  type=date, keyboard-enterable
│ 오늘로 기본 설정됩니다. 과거 날짜를   │  explicit back-dating hint
│ 입력할 수 있습니다.                  │
│                                     │
│ 수량            단가                 │
│ [ 50      ]     [ 81,200        ]   │  inputmode="decimal"
│                                     │
│ 금액  ₩4,060,000                     │  computed, read-only
│                                     │
│ ⚠ 보유 수량(30주)을 초과하는          │  ValidationError, associated
│   매도입니다.                        │
│                                     │
│        [ 취소 ]  [ 저장 ]            │
└─────────────────────────────────────┘
```

**Components**: `SegmentedFilter`, `TransactionRow`, `TransactionForm` (`TypeSelector`,
`SecurityPicker`, `DateField`, `QuantityField`, `PriceField`, `ComputedAmount`, `ValidationError`),
`VoidConfirm`, `Badge`.

**States**

| State | Presentation |
|-------|--------------|
| Empty | "직접 입력한 거래가 없습니다" + explanation that uploads cover the rest. |
| Loading | Row skeletons grouped by date. |
| Error (save failed) | Inline in the form, focus moved to the error, form values preserved. |
| Over-sell rejection | `⚠ 보유 수량(30주)을 초과하는 매도입니다` — **names the current quantity** (WCAG 3.3.1/3.3.3), `aria-describedby`-associated to the quantity field, no partial write. |
| Superseded | Row de-emphasized with a `대체됨` badge naming the superseding snapshot date. Struck-through text is accompanied by the badge, never used alone. |
| Voided | `취소됨` badge; the row **remains in the table** (`voided_at` set, row not deleted). |
| Stale | Not applicable — transactions are user-entered facts, not provider data. |

**Accessibility notes** (this screen carries most of the spec's explicit form requirements):
- Every input has an associated `<label>`; numeric inputs use `inputmode="decimal"`.
- **The date field accepts keyboard entry and never requires a pointer-driven picker.** The 📅
  affordance is an optional additive control, not the only path.
- Validation errors are programmatically associated and state the correction, not just the failure.
- Voiding has a keyboard-reachable and keyboard-dismissible confirm step that **returns focus to the
  originating control** on cancel.
- The bottom sheet traps focus while open, closes on `Esc`, and restores focus on close.
- All controls ≥44×44; the type selector's four options are each a full-height target.

---

## 4. State model summary

Every screen must implement all applicable states; "we'll add empty states later" is how a
single-user prototype ends up showing `₩0` for "no data yet" and lying to its only user.

| Screen | Empty | Loading | Error | Stale |
|--------|-------|---------|-------|-------|
| `/` | ✅ two distinct empties (no snapshot / no briefing) | ✅ skeleton | ✅ section-level | ✅ banner + per-figure badge |
| `/portfolio` | ✅ | ✅ table skeleton | ✅ | ✅ per-row badge, snapshot-value fallback |
| `/holdings/[id]` | ✅ per-section | ✅ progressive | ✅ per-section | ✅ badge + separated manual txns |
| `/transactions` | ✅ | ✅ | ✅ inline in form | n/a |

---

## 5. Language and `lang` attributes

- Document is `<html lang="ko">`. The briefing is Korean prose.
- A genuinely English **passage** (a quoted headline, an English source summary) carries
  `lang="en"` on its own element, driven by `news_item.lang` captured at ingest — the renderer knows,
  it does not guess.
- **Do not** reflexively wrap a bare ticker like `SMPL` inside a Korean sentence in `lang="en"`. Mark
  passages, not tokens. The exception is a whole company name a screen reader would otherwise
  mispronounce.
- Korean preferred-share suffixes (`우`, `우B`) are part of the security name and are never
  normalized away in display, because `가나전자` and `가나전자우` are different securities.

---

## 6. Accessibility conformance checklist (this spec's contribution)

| Requirement (spec 0001 § Accessibility) | How this spec satisfies it |
|---|---|
| Gain/loss never colour-alone | `PLFigure` (§2.1) is the only permitted renderer; 4 channels, colour removable. |
| Korean convention up=red/down=blue, one convention app-wide | `--color-value-up`/`-down` semantic tokens; no per-market branch anywhere in this spec. |
| `estimated` quantity marked as non-colour | `추정 수량` text badge + "(추정)" in the figure's own words. |
| Touch targets ≥44×44, primary actions one-handed | §1.1 layout contract; every row, tab, badge-button and form control specified ≥44px; primary CTAs in the lower third. |
| Contrast ≥4.5:1 text / ≥3:1 UI, both themes | Verified in [`docs/design.md`](../design.md) § 2 for all directional tokens in light and dark. |
| Real `<table>` semantics for numeric grids | §2.3 / §3.2 — `<table>`, `<caption>`, `scope`d headers. |
| `prefers-reduced-motion` | §3.3 sparkline; `compile-tokens.ts` zeroes every motion duration automatically. |
| Visible focus, no keyboard traps | `--focus-ring` token on every interactive element; §3.4 bottom sheet has explicit focus-restore. |
| Form labels, `inputmode`, associated errors, keyboard date entry | §3.4 accessibility notes. |
| `lang="ko"` document, `lang="en"` passages | §5. |
| Heading hierarchy for screen-reader skipping | §3.1 `h1→h2→h3` per holding. |

Verification is by the `accessibility-audit` skill (axe-core, WCAG 2.1 AA) plus a manual keyboard and
screen-reader pass on the add-transaction flow including its error states — as spec 0001 requires.
Note that axe cannot detect the colour-only failure mode; the `PLFigure` component contract is the
actual control, which is why the spec forbids rendering signed figures outside it.

---

## 7. Visual alpha

[`docs/mockups/alpha-v1.html`](../mockups/alpha-v1.html) — a single self-contained static HTML file
rendering all four screens in a 390px phone frame with tab switching. No build step, no framework, no
external network requests. Its `:root` block is transcribed from `tokens.json`; all data in it is
**invented**, and no content from the user's real export appears anywhere.

It is a design-communication artifact only. It lives under `docs/mockups/` and is not application
code — nothing in the architect's implementation plan governs it.

---

## 8. Open questions

- **OQ-1 — `/upload` and `/settings` are not designed.** Deferred to the next design round.
  `/upload` is the more complex of the two (file pick → as-of date confirm → parse preview → diff vs.
  current holdings → list of superseded transactions → unknown-label resolution → commit) and
  deserves its own pass; spec 0001 also flags its keyboard-trap risk specifically.
- **OQ-2 — Icon system undecided.** The alpha uses inline glyph triangles for direction only. A
  library choice (single library, fixed size/stroke, `aria-label` policy) is deferred.
- **OQ-3 — Component token layer unwritten.** This spec describes components behaviourally;
  `--button-primary-bg`-style component tokens do not exist yet, so a full component sheet is
  deferred.
- **OQ-4 — Dark theme is calculated, not reviewed.** All dark values are AA-verified arithmetically
  but have not been seen in situ. The alpha renders light only.
- **OQ-5 — Sparkline library vs. inline SVG** on `/holdings/[id]` — undecided; the accessibility
  contract (`role="img"`, text-duplicated range, reduced-motion) holds either way.
- **OQ-6 — `stale` and `estimated` currently share one colour ramp.** They are separate tokens so
  they can diverge; whether they *should* is a question for after the direction is approved.
- **OQ-7 — Korean webfont.** Platform stack for the alpha; a Pretendard-class self-hosted face is a
  licensing/perf decision, not a visual-direction one.

---

*Author: visual-designer · alpha pass, 2026-09-08.*
