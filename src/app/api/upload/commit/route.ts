import crypto from "node:crypto";
import { and, eq, isNull, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { holding, manualTransaction, portfolioSnapshot, security, securityAlias } from "@/db/schema";
import { todayInSeoul } from "@/lib/dates";
import { parseSamsungSecuritiesXlsx } from "@/lib/parsers/samsung-securities";
import { resolveSecurity, type AliasCandidate, type SecurityCandidate } from "@/lib/securities/resolve";

/**
 * `POST /api/upload/commit` — commits a previewed parse as a new
 * `portfolio_snapshot` with a user-confirmed `as_of_date`, and applies
 * ADR-0004 §4 supersession in the same transaction. Rejects a `file_sha256`
 * already present (spec 0001 acceptance criteria: re-uploading the identical
 * file is rejected as a duplicate without creating a second snapshot).
 *
 * Accepts `aliasBindings` (rawLabel -> securityId) so a row that was
 * unresolved in the `/api/upload` preview can be bound just before commit —
 * consistent with `/api/securities/alias` being "expected to be routine"
 * since the export gives no ticker code. Any row still unresolved after
 * applying bindings aborts the whole commit (no partial write).
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

  let aliasBindings: { rawLabel: string; securityId: number }[] = [];
  const aliasBindingsField = formData.get("aliasBindings");
  if (typeof aliasBindingsField === "string" && aliasBindingsField.length > 0) {
    try {
      const parsed = JSON.parse(aliasBindingsField);
      if (Array.isArray(parsed)) {
        aliasBindings = parsed.filter(
          (b): b is { rawLabel: string; securityId: number } =>
            typeof b?.rawLabel === "string" && typeof b?.securityId === "number",
        );
      }
    } catch {
      return NextResponse.json({ error: "aliasBindings must be a JSON array" }, { status: 400 });
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileSha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  const existing = await db.select().from(portfolioSnapshot).where(eq(portfolioSnapshot.fileSha256, fileSha256)).limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "This file has already been committed as a snapshot.", fileSha256, existingSnapshotId: existing[0]!.id },
      { status: 409 },
    );
  }

  const parseResult = await parseSamsungSecuritiesXlsx(buffer);

  const result = await db.transaction(async (tx) => {
    for (const binding of aliasBindings) {
      await tx
        .insert(securityAlias)
        .values({ securityId: binding.securityId, rawLabel: binding.rawLabel })
        .onConflictDoNothing({ target: securityAlias.rawLabel });
    }

    const allSecurities = (await tx.select().from(security)) as unknown as SecurityCandidate[];
    const allAliases = (await tx.select().from(securityAlias)) as unknown as AliasCandidate[];

    const stillUnresolved: { rowNumber: number; reason: string }[] = parseResult.unresolved.map((u) => ({
      rowNumber: u.rowNumber,
      reason: u.reason,
    }));
    const resolvedRows: {
      rowNumber: number;
      rawLabel: string;
      currency: "KRW" | "USD";
      marketValue: string;
      costBasisTotal: string;
      securityId: number;
    }[] = [];

    for (const row of parseResult.rows) {
      const resolution = resolveSecurity({ rawLabel: row.rawLabel, currency: row.currency }, allSecurities, allAliases);
      if (resolution.status === "resolved") {
        resolvedRows.push({ ...row, securityId: resolution.securityId });
      } else {
        stillUnresolved.push({
          rowNumber: row.rowNumber,
          reason: `No matching security or alias for '${row.rawLabel}' (${row.currency})`,
        });
      }
    }

    if (stillUnresolved.length > 0) {
      return { ok: false as const, unresolved: stillUnresolved };
    }

    const inserted = await tx
      .insert(portfolioSnapshot)
      .values({
        asOfDate,
        sourceFilename: file.name,
        fileSha256,
        broker: "samsung-securities",
        profileVersion: parseResult.profileVersion,
        rowCount: resolvedRows.length,
        warnings: parseResult.warnings,
      })
      .returning({ id: portfolioSnapshot.id });
    const snapshotRow = inserted[0];
    if (!snapshotRow) throw new Error("Failed to insert portfolio_snapshot: insert returned no row");
    const snapshotId = snapshotRow.id;

    if (resolvedRows.length > 0) {
      await tx.insert(holding).values(
        resolvedRows.map((row) => ({
          snapshotId,
          securityId: row.securityId,
          rawLabel: row.rawLabel,
          quantity: null,
          avgCost: null,
          costBasisTotal: row.costBasisTotal,
          marketValueAtUpload: row.marketValue,
          currency: row.currency,
          raw: { rawLabel: row.rawLabel, currency: row.currency, marketValue: row.marketValue, costBasisTotal: row.costBasisTotal },
        })),
      );
    }

    // ADR-0004 §4: supersede, retain, never delete.
    await tx
      .update(manualTransaction)
      .set({ supersededBySnapshotId: snapshotId })
      .where(
        and(
          isNull(manualTransaction.voidedAt),
          isNull(manualTransaction.supersededBySnapshotId),
          lte(manualTransaction.transactionDate, asOfDate),
        ),
      );

    return { ok: true as const, snapshotId, rowCount: resolvedRows.length };
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Some rows could not be resolved to a security. Bind aliases and retry.", unresolved: result.unresolved },
      { status: 422 },
    );
  }

  return NextResponse.json({ snapshotId: result.snapshotId, asOfDate, rowCount: result.rowCount }, { status: 201 });
}
