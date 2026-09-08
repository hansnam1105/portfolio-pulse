import "server-only";

/**
 * `getCurrentPortfolio` — the shared "what do I own right now, across every
 * security" aggregation the UI needs (Today's Briefing, Portfolio, and Holding
 * detail all need this exact fold — spec 0001 § current_holding requires it be
 * computed in exactly one place). This module is UI-facing plumbing around
 * src/lib/holdings/current.ts's `computeCurrentHolding` (the actual fold logic,
 * which this file does not reimplement) plus KRW normalization for the
 * portfolio-wide total, which no existing backend module computes.
 *
 * Server-only: queries Postgres directly (ADR-0002 — no client-callable
 * pass-through for provider/DB data). Pure aggregation, no writes.
 */
import { desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { fxRateDaily, holding, manualTransaction, portfolioSnapshot, priceDaily, security } from "@/db/schema";
import {
  computeCurrentHolding,
  type CurrentHoldingResult,
  type ManualTransactionInput,
} from "@/lib/holdings/current";
import { Decimal, ZERO, add, divSafe, mul } from "@/lib/money";

export interface PortfolioSecurity {
  securityId: number;
  market: "KRX" | "US";
  symbol: string;
  nameLocal: string;
  nameEn: string | null;
  currency: "KRW" | "USD";
}

export interface PortfolioHoldingRow {
  security: PortfolioSecurity;
  result: CurrentHoldingResult;
  latestClose: string | null;
  /** `valueCurrent` (or `frozenValue` when stale) normalized to KRW using the
   * latest fx_rate_daily row. Null when unavailable (no price yet, or a USD
   * holding with no fx rate on record) — callers must not divide by/sum a null
   * as if it were zero (spec 0002 §3.2 "zero-valuation row"). */
  valueKrw: Decimal | null;
  weightPct: Decimal | null;
}

export interface CurrentPortfolio {
  latestSnapshot: { id: number; asOfDate: string; uploadedAt: Date } | null;
  fxRate: { rate: string; rateDate: string } | null;
  rows: PortfolioHoldingRow[];
  totalValueKrw: Decimal;
  totalCostBasisKrw: Decimal;
}

export async function getCurrentPortfolio(): Promise<CurrentPortfolio> {
  const [latestSnapshotRows, allSecurities, activeTransactions, latestFxRows] = await Promise.all([
    db
      .select()
      .from(portfolioSnapshot)
      .orderBy(desc(portfolioSnapshot.asOfDate), desc(portfolioSnapshot.uploadedAt))
      .limit(1),
    db.select().from(security),
    db.select().from(manualTransaction).where(isNull(manualTransaction.voidedAt)),
    db.select().from(fxRateDaily).where(eq(fxRateDaily.pair, "USDKRW")).orderBy(desc(fxRateDaily.rateDate)).limit(1),
  ]);
  const latestSnapshot = latestSnapshotRows[0] ?? null;
  const fxRateRow = latestFxRows[0] ?? null;

  const holdingRows = latestSnapshot
    ? await db.select().from(holding).where(eq(holding.snapshotId, latestSnapshot.id))
    : [];

  const securityIdsWithActivity = new Set<number>([
    ...holdingRows.map((h) => h.securityId),
    ...activeTransactions.filter((t) => t.supersededBySnapshotId === null).map((t) => t.securityId),
  ]);

  const priceRows = securityIdsWithActivity.size > 0 ? await db.select().from(priceDaily) : [];

  const rows: Omit<PortfolioHoldingRow, "weightPct">[] = [];

  for (const securityId of securityIdsWithActivity) {
    const sec = allSecurities.find((s) => s.id === securityId);
    if (!sec) continue;

    const holdingRow = holdingRows.find((row) => row.securityId === securityId) ?? null;
    const transactions: ManualTransactionInput[] = activeTransactions
      .filter((t) => t.securityId === securityId)
      .map((t) => ({
        id: t.id,
        kind: t.kind,
        quantity: t.quantity,
        price: t.price,
        fees: t.fees,
        costBasisTotal: t.costBasisTotal,
        transactionDate: t.transactionDate,
        createdAt: t.createdAt.toISOString(),
        voidedAt: null,
        supersededBySnapshotId: t.supersededBySnapshotId,
      }));

    const securityPriceRows = priceRows.filter((p) => p.securityId === securityId);
    const priceAtAsOfDate = latestSnapshot
      ? (securityPriceRows.find((p) => p.tradeDate === latestSnapshot.asOfDate)?.close ?? null)
      : null;
    const latestPriceRow = [...securityPriceRows].sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : -1))[0];
    const latestClose = latestPriceRow?.close ?? null;

    const result = computeCurrentHolding({
      securityId,
      snapshotAsOfDate: latestSnapshot?.asOfDate ?? null,
      holding: holdingRow
        ? {
            quantity: holdingRow.quantity,
            costBasisTotal: holdingRow.costBasisTotal,
            marketValueAtUpload: holdingRow.marketValueAtUpload,
            currency: holdingRow.currency,
          }
        : null,
      transactions,
      priceAtAsOfDate,
      latestClose,
    });

    let valueKrw: Decimal | null = null;
    if (result.status === "ok" && result.valueCurrent !== null) {
      valueKrw = sec.currency === "KRW" ? result.valueCurrent : fxRateRow ? mul(result.valueCurrent, fxRateRow.rate) : null;
    } else if (result.status === "stale") {
      valueKrw = sec.currency === "KRW" ? result.frozenValue : fxRateRow ? mul(result.frozenValue, fxRateRow.rate) : null;
    }

    rows.push({
      security: {
        securityId: sec.id,
        market: sec.market,
        symbol: sec.symbol,
        nameLocal: sec.nameLocal,
        nameEn: sec.nameEn,
        currency: sec.currency,
      },
      result,
      latestClose,
      valueKrw,
    });
  }

  const totalValueKrw = rows.reduce((sum, r) => (r.valueKrw ? add(sum, r.valueKrw) : sum), ZERO);
  const totalCostBasisKrw = rows.reduce((sum, r) => {
    if (r.result.status !== "ok") return sum;
    const costKrw =
      r.security.currency === "KRW" ? r.result.costBasis : fxRateRow ? mul(r.result.costBasis, fxRateRow.rate) : null;
    return costKrw ? add(sum, costKrw) : sum;
  }, ZERO);

  const withWeights: PortfolioHoldingRow[] = rows.map((r) => ({
    ...r,
    weightPct: r.valueKrw && !totalValueKrw.isZero() ? divSafe(mul(r.valueKrw, 100), totalValueKrw) : null,
  }));

  // Stable, deterministic display order: KRW value desc, unvalued rows last.
  withWeights.sort((a, b) => {
    const av = a.valueKrw ?? new Decimal(-1);
    const bv = b.valueKrw ?? new Decimal(-1);
    return bv.comparedTo(av);
  });

  return {
    latestSnapshot: latestSnapshot ? { id: latestSnapshot.id, asOfDate: latestSnapshot.asOfDate, uploadedAt: latestSnapshot.uploadedAt } : null,
    fxRate: fxRateRow ? { rate: fxRateRow.rate, rateDate: fxRateRow.rateDate } : null,
    rows: withWeights,
    totalValueKrw,
    totalCostBasisKrw,
  };
}

export function findHoldingRow(portfolio: CurrentPortfolio, securityId: number): PortfolioHoldingRow | undefined {
  return portfolio.rows.find((r) => r.security.securityId === securityId);
}
