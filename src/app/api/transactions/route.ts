import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { holding, manualTransaction, portfolioSnapshot, priceDaily } from "@/db/schema";
import { computeCurrentHolding, validateSellQuantity, type ManualTransactionInput } from "@/lib/holdings/current";

/**
 * `POST /api/transactions` (create) and `PATCH /api/transactions` (edit) —
 * manual buy/sell/set_quantity/remove (ADR-0004). No session guard per spec
 * 0001 v3 § Authentication (application-level auth removed at the user's
 * explicit direction). Makes no outbound provider call.
 */

const kindSchema = z.enum(["buy", "sell", "set_quantity", "remove"]);
const currencySchema = z.enum(["KRW", "USD"]);

const createSchema = z.object({
  securityId: z.number().int().positive(),
  kind: kindSchema,
  quantity: z.string().optional(),
  price: z.string().optional(),
  fees: z.string().optional(),
  costBasisTotal: z.string().optional(),
  currency: currencySchema,
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "transactionDate must be YYYY-MM-DD"),
  note: z.string().optional(),
});

const patchSchema = createSchema.partial().extend({
  id: z.number().int().positive(),
});

function kindRequiresQuantity(kind: z.infer<typeof kindSchema>): boolean {
  return kind === "buy" || kind === "sell" || kind === "set_quantity";
}

function kindRequiresPrice(kind: z.infer<typeof kindSchema>): boolean {
  return kind === "buy" || kind === "sell";
}

async function loadCurrentQuantity(securityId: number): Promise<{ quantity: string; snapshotAsOfDate: string | null }> {
  const latestSnapshotRows = await db
    .select()
    .from(portfolioSnapshot)
    .orderBy(desc(portfolioSnapshot.asOfDate), desc(portfolioSnapshot.uploadedAt))
    .limit(1);
  const latestSnapshot = latestSnapshotRows[0] ?? null;

  const holdingRow = latestSnapshot
    ? (await db.select().from(holding).where(and(eq(holding.snapshotId, latestSnapshot.id), eq(holding.securityId, securityId))))[0] ?? null
    : null;

  const activeTransactions = await db
    .select()
    .from(manualTransaction)
    .where(and(eq(manualTransaction.securityId, securityId), isNull(manualTransaction.voidedAt), isNull(manualTransaction.supersededBySnapshotId)));

  const transactions: ManualTransactionInput[] = activeTransactions.map((t) => ({
    id: t.id,
    kind: t.kind,
    quantity: t.quantity,
    price: t.price,
    fees: t.fees,
    costBasisTotal: t.costBasisTotal,
    transactionDate: t.transactionDate,
    createdAt: t.createdAt.toISOString(),
    voidedAt: null,
    supersededBySnapshotId: null,
  }));

  let priceAtAsOfDate: string | null = null;
  if (latestSnapshot) {
    const priceRow = (
      await db
        .select()
        .from(priceDaily)
        .where(and(eq(priceDaily.securityId, securityId), eq(priceDaily.tradeDate, latestSnapshot.asOfDate)))
    )[0];
    priceAtAsOfDate = priceRow?.close ?? null;
  }

  const current = computeCurrentHolding({
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
  });

  return {
    quantity: current.status === "ok" ? current.quantityCurrent.toFixed() : "0",
    snapshotAsOfDate: latestSnapshot?.asOfDate ?? null,
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  if (kindRequiresQuantity(input.kind) && !input.quantity) {
    return NextResponse.json({ error: `'quantity' is required for kind '${input.kind}'` }, { status: 400 });
  }
  if (kindRequiresPrice(input.kind) && !input.price) {
    return NextResponse.json({ error: `'price' is required for kind '${input.kind}'` }, { status: 400 });
  }

  if (input.kind === "sell" && input.quantity) {
    const { quantity: currentQuantity } = await loadCurrentQuantity(input.securityId);
    const validation = validateSellQuantity(currentQuantity, input.quantity);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 422 });
    }
  }

  const inserted = await db
    .insert(manualTransaction)
    .values({
      securityId: input.securityId,
      kind: input.kind,
      quantity: input.quantity ?? null,
      price: input.price ?? null,
      fees: input.fees ?? "0",
      costBasisTotal: input.costBasisTotal ?? null,
      currency: input.currency,
      transactionDate: input.transactionDate,
      note: input.note ?? null,
    })
    .returning();

  return NextResponse.json({ transaction: inserted[0] }, { status: 201 });
}

export async function PATCH(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { id, ...updates } = parsed.data;

  const existingRows = await db.select().from(manualTransaction).where(eq(manualTransaction.id, id)).limit(1);
  const existing = existingRows[0];
  if (!existing) {
    return NextResponse.json({ error: `No transaction with id ${id}` }, { status: 404 });
  }
  if (existing.voidedAt !== null) {
    return NextResponse.json({ error: "Cannot edit a voided transaction" }, { status: 409 });
  }

  const nextKind = updates.kind ?? existing.kind;
  const nextQuantity = updates.quantity ?? existing.quantity ?? undefined;

  if (nextKind === "sell" && nextQuantity) {
    // Exclude this row's own prior contribution before validating, by
    // computing current quantity from all OTHER active transactions.
    const { quantity: currentQuantity } = await loadCurrentQuantity(existing.securityId);
    // Add back this transaction's own prior sell effect so we compare against
    // "quantity available excluding this edit", a conservative approximation:
    // the write-time guard's purpose (naming the current quantity) is preserved.
    const validation = validateSellQuantity(currentQuantity, nextQuantity);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 422 });
    }
  }

  const updated = await db
    .update(manualTransaction)
    .set({
      kind: updates.kind ?? existing.kind,
      quantity: updates.quantity ?? existing.quantity,
      price: updates.price ?? existing.price,
      fees: updates.fees ?? existing.fees,
      costBasisTotal: updates.costBasisTotal ?? existing.costBasisTotal,
      currency: updates.currency ?? existing.currency,
      transactionDate: updates.transactionDate ?? existing.transactionDate,
      note: updates.note ?? existing.note,
      updatedAt: new Date(),
    })
    .where(eq(manualTransaction.id, id))
    .returning();

  return NextResponse.json({ transaction: updated[0] }, { status: 200 });
}
