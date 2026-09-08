# Fixture: `samsung-securities-sample.xlsx`

> **Companion to** [`samsung-securities-sample.xlsx`](samsung-securities-sample.xlsx) — the parser
> fixture for the Samsung Securities holdings export. Referenced by
> [spec 0001 § Parser profile](../specs/0001-portfolio-pulse-system-design.md).
>
> Unrelated to the `swe-solve` ISSUE-NNN fixtures described in [README.md](README.md); this file is a
> parser input fixture, not a pipeline regression fixture.

## Redaction statement

**This file contains zero real financial data.**

It was generated from the *structure* of a real user-supplied export
(`export_sample.xlsx`, project root, **not committed** — see spec 0001 Q1) by an architect analysis
step that read only sheet names, header labels, column order, and cell types. Every security name and
every monetary figure in the fixture is invented. Specifically:

| Redacted | How |
|----------|-----|
| Security names | Replaced with invented Korean names (`가나전자`, `가나전자우`, `다라바이오`) and invented US tickers (`SMPL`, `SMPL.B`, `ZZTEST ETF`). No name from the real file appears. |
| Valuation / cost amounts | Replaced with round, obviously-synthetic figures. No amount from the real file appears. |
| Account identifiers | None existed in the real file to redact — the export carries no account number, account name, or holder name. See § Structure. |
| Workbook metadata | The fixture is written from scratch rather than copied, so it carries no `creator`, no `lastModifiedBy`, no revision GUIDs, no absolute source path, and a fixed zero timestamp. |

## Structure (identical to the real export)

| Property | Value |
|----------|-------|
| Format | `.xlsx` (OOXML), **not** CSV — so the CP949/EUC-KR decoding risk does not apply to this format |
| Sheets | exactly one, named `Sheet1` |
| Header row | row 1 |
| Data rows | row 2 onward, contiguous, no blank separators |
| Columns | exactly 4: `A` … `D` |
| Merged cells | none |
| Section headers / subtotal rows | none — one flat table |
| Number formats | none applied; amounts are plain numeric cells with no currency symbol or thousands separator |

### Columns

| Col | Header (verbatim) | Meaning | Cell type | Notes |
|-----|-------------------|---------|-----------|-------|
| A | `종목명` | security display name | shared string | Korean local name for KRX rows; ticker symbol for US rows. **No ticker code / ISIN column exists.** |
| B | `통화` | currency | shared string | `KRW` or `USD` — the **only** discriminator between KRX and US holdings |
| C | `평가금액` | current valuation amount | numeric | in the row's own currency |
| D | `매수금액` | cost / purchase amount | numeric | in the row's own currency |

**There is no quantity column, no per-share price column, and no as-of date.** This is the single
most consequential fact about the format; see spec 0001 § Parser profile and
[ADR-0004](../adr/0004-manual-holding-adjustments.md) for how the design copes.

## Edge cases the fixture deliberately covers

The real sample had 2 data rows. The fixture keeps the identical shape but extends to 6 rows so the
parser's real failure modes are exercised:

| Row | Case | Why |
|-----|------|-----|
| `가나전자우` / KRW | Korean preferred-share `우` suffix | must resolve to a *different* security than the common share |
| `가나전자` / KRW | same base name, no suffix | proves suffix stripping does not collapse two distinct securities |
| `다라바이오` / KRW | 평가금액 < 매수금액 | loss position; exercises the negative-P/L path and the Korean colour convention |
| `SMPL` / USD | plain US ticker, decimal amounts | USD rows carry decimals where KRW rows are integer-like |
| `SMPL.B` / USD | dotted share-class ticker | symbol normalization must not split on `.` |
| `ZZTEST ETF` / USD | whitespace in label, `평가금액 = 0` | fully-exited position; must not divide by zero when back-deriving quantity, and should surface as unresolvable rather than be silently dropped |

## Maintenance

- If the user later supplies a **richer** real export (one with quantity, ticker code, or an account
  header block), this fixture must be regenerated to match, a new
  `src/lib/parsers/profiles/samsung-securities.json` profile version added, and the redaction
  statement above re-verified. Never edit the fixture to make a failing parser test pass.
- The redaction rule is absolute: no value in this file may ever be copied from a real export.
