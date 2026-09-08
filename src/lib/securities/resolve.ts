/**
 * Resolves a parsed export row's `raw_label` (종목명) to a `security` row
 * (spec 0001 § Files to change: src/lib/securities/resolve.ts).
 *
 * The export carries no ticker code or ISIN (spec 0001 § Parser profile), so
 * resolution is by exact display label, with `통화` as the sole KRX/US
 * discriminator:
 *   - KRW rows match against `security.nameLocal` within market='KRX'.
 *   - USD rows match against `security.symbol` within market='US'.
 * `security_alias` is the manual override path for anything that doesn't
 * match, and is expected to be used routinely, not exceptionally.
 *
 * Two normalization rules are load-bearing (spec 0001 acceptance criteria):
 *   - Korean preferred-share suffixes (`우`, `우B`) are NEVER stripped —
 *     `가나전자우` and `가나전자` must resolve to two distinct securities.
 *   - A dotted US ticker (`SMPL.B`) is NEVER split on `.` — it is compared
 *     as a whole string.
 * The only normalization applied is trimming surrounding whitespace (so
 * `ZZTEST ETF` with incidental whitespace still has a chance to match) and,
 * for USD symbols only, case-insensitive comparison (tickers have no
 * meaningful case; Korean names have no case concept at all).
 *
 * This module is pure — it takes already-loaded `security`/`security_alias`
 * rows and returns a resolution decision, so it is fully unit-testable
 * without a database (spec 0001 § Files to change: tests/**). The caller
 * (upload route) is responsible for loading candidates from Postgres and,
 * for an alias-bound row, for the actual `security_alias` write.
 */
import type { Currency } from "@/lib/parsers/samsung-securities";

export type Market = "KRX" | "US";

export interface SecurityCandidate {
  id: number;
  market: Market;
  symbol: string;
  nameLocal: string;
  nameEn?: string | null;
  currency: Currency;
}

export interface AliasCandidate {
  securityId: number;
  rawLabel: string;
}

export interface ResolveInput {
  rawLabel: string;
  currency: Currency;
}

export type ResolveResult =
  | { status: "resolved"; securityId: number; via: "name" | "symbol" | "alias" }
  | { status: "unresolved"; rawLabel: string; currency: Currency; market: Market };

/** `통화` is the sole KRX-vs-US discriminator (spec 0001 § Parser profile). */
export function marketFromCurrency(currency: Currency): Market {
  return currency === "KRW" ? "KRX" : "US";
}

export function resolveSecurity(
  input: ResolveInput,
  securities: readonly SecurityCandidate[],
  aliases: readonly AliasCandidate[],
): ResolveResult {
  const trimmedLabel = input.rawLabel.trim();
  const market = marketFromCurrency(input.currency);

  if (market === "KRX") {
    const match = securities.find((s) => s.market === "KRX" && s.nameLocal === trimmedLabel);
    if (match) return { status: "resolved", securityId: match.id, via: "name" };
  } else {
    const upperLabel = trimmedLabel.toUpperCase();
    const match = securities.find((s) => s.market === "US" && s.symbol.toUpperCase() === upperLabel);
    if (match) return { status: "resolved", securityId: match.id, via: "symbol" };
  }

  const alias = aliases.find((a) => a.rawLabel === trimmedLabel);
  if (alias) return { status: "resolved", securityId: alias.securityId, via: "alias" };

  return { status: "unresolved", rawLabel: trimmedLabel, currency: input.currency, market };
}
