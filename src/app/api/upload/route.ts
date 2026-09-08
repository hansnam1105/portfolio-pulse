import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { holding, manualTransaction, portfolioSnapshot, priceDaily, security, securityAlias } from "@/db/schema";
import { todayInSeoul } from "@/lib/dates";
import { computeCurrentHolding, type ManualTransactionInput } from "@/lib/holdings/current";
import { parseSamsungSecuritiesXlsx } from "@/lib/parsers/samsung-securities";
import {
  marketFromCurrency,
  resolveSecurity,
  type AliasCandidate,
  type SecurityCandidate,
} from "@/lib/securities/resolve";

/**
 * `POST /api/upload` — parse-only preview (spec 0001 § Internal API surface).
 * Writes nothing. Returns `{ parsed[], unresolved[], warnings[], diffVsCurrent,
 * willSupersede[] }` so the upload screen can show what committing would do
 * before the user confirms `as_of_date`.
 */
export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field in multipart form data" }, { status: 400 });
  }

  const asOfDateField = formData.get("asOfDate");
  const asOfDate = typeof asOfDateField === "string" && asOfDateField.length > 0 ? asOfDateField : todayInSeoul();

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileSha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  const parseResult = await parseSamsungSecuritiesXlsx(buffer);

  const [existingSnapshot, allSecurities, allAliases, activeTransactions, latestSnapshotRows] = await Promise.all([
    db.select().from(portfolioSnapshot).where(eq(portfolioSnapshot.fileSha256, fileSha256)).limit(1),
    db.select().from(security),
    db.select().from(securityAlias),
    db
      .select()
      .from(manualTransaction)
      .where(and(isNull(manualTransaction.voidedAt), isNull(manualTransaction.supersededBySnapshotId))),
    db
      .select()
      .from(portfolioSnapshot)
      .orderBy(desc(portfolioSnapshot.asOfDate), desc(portfolioSnapshot.uploadedAt))
      .limit(1),
  ]);
  const latestSnapshot = latestSnapshotRows[0] ?? null;
  const latestHoldingRows = latestSnapshot
    ? await db.select().from(holding).where(eq(holding.snapshotId, latestSnapshot.id))
    : [];
  const priceRows = latestSnapshot ? await db.select().from(priceDaily) : [];

  const securityCandidates = allSecurities as unknown as SecurityCandidate[];
  const aliasCandidates = allAliases as unknown as AliasCandidate[];

  const unresolved: { rowNumber: number; reason: string; raw: Record<string, unknown> }[] = [
    ...parseResult.unresolved,
  ];
  const parsed: {
    rowNumber: number;
    rawLabel: string;
    currency: "KRW" | "USD";
    market: "KRX" | "US";
    marketValue: string;
    costBasisTotal: string;
    securityId: number | null;
    resolvedVia: "name" | "symbol" | "alias" | null;
  }[] = [];

  for (const row of parseResult.rows) {
    const resolution = resolveSecurity({ rawLabel: row.rawLabel, currency: row.currency }, securityCandidates, aliasCandidates);
    if (resolution.status === "resolved") {
      parsed.push({
        rowNumber: row.rowNumber,
        rawLabel: row.rawLabel,
        currency: row.currency,
        market: marketFromCurrency(row.currency),
        marketValue: row.marketValue,
        costBasisTotal: row.costBasisTotal,
        securityId: resolution.securityId,
        resolvedVia: resolution.via,
      });
    } else {
      // Never silently drop a row (spec 0001 acceptance criteria).
      unresolved.push({
        rowNumber: row.rowNumber,
        reason: `No matching security or alias for '${row.rawLabel}' (${row.currency})`,
        raw: { rawLabel: row.rawLabel, currency: row.currency, marketValue: row.marketValue, costBasisTotal: row.costBasisTotal },
      });
      parsed.push({
        rowNumber: row.rowNumber,
        rawLabel: row.rawLabel,
        currency: row.currency,
        market: marketFromCurrency(row.currency),
        marketValue: row.marketValue,
        costBasisTotal: row.costBasisTotal,
        securityId: null,
        resolvedVia: null,
      });
    }
  }

  // willSupersede: active manual_transaction rows dated on/before the confirmed as_of_date.
  const willSupersede = activeTransactions.filter((t) => t.transactionDate <= asOfDate);

  // diffVsCurrent: for each resolved row, compare the incoming export figures
  // against current_holding computed from the *existing* snapshot+transactions
  // (i.e. what the portfolio looks like right now, before this upload).
  const diffVsCurrent = parsed
    .filter((row): row is typeof row & { securityId: number } => row.securityId !== null)
    .map((row) => {
      const transactionsForSecurity: ManualTransactionInput[] = activeTransactions
        .filter((t) => t.securityId === row.securityId)
        .map((t) => ({
          id: t.id,
          kind: t.kind,
          quantity: t.quantity,
          price: t.price,
          fees: t.fees,
          costBasisTotal: t.costBasisTotal,
          transactionDate: t.transactionDate,
          createdAt: t.createdAt.toISOString(),
          voidedAt: t.voidedAt ? t.voidedAt.toISOString() : null,
          supersededBySnapshotId: t.supersededBySnapshotId,
        }));

      const priorHoldingRow = latestHoldingRows.find((h) => h.securityId === row.securityId) ?? null;
      const priceAtAsOfDate = latestSnapshot
        ? priceRows.find((p) => p.securityId === row.securityId && p.tradeDate === latestSnapshot.asOfDate)?.close ?? null
        : null;

      const current = computeCurrentHolding({
        securityId: row.securityId,
        snapshotAsOfDate: latestSnapshot?.asOfDate ?? null,
        holding: priorHoldingRow
          ? {
              quantity: priorHoldingRow.quantity,
              costBasisTotal: priorHoldingRow.costBasisTotal,
              marketValueAtUpload: priorHoldingRow.marketValueAtUpload,
              currency: priorHoldingRow.currency,
            }
          : null,
        transactions: transactionsForSecurity,
        priceAtAsOfDate,
      });

      return {
        securityId: row.securityId,
        rawLabel: row.rawLabel,
        incomingMarketValue: row.marketValue,
        incomingCostBasisTotal: row.costBasisTotal,
        currentQuantity: current.status === "ok" ? current.quantityCurrent.toFixed() : null,
        currentCostBasis: current.status === "ok" ? current.costBasis.toFixed() : null,
      };
    });

  return NextResponse.json({
    fileSha256,
    asOfDate,
    alreadyCommitted: existingSnapshot.length > 0,
    profileVersion: parseResult.profileVersion,
    parsed,
    unresolved,
    warnings: parseResult.warnings,
    diffVsCurrent,
    willSupersede,
  });
}
