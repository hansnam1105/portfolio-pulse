import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { manualTransaction } from "@/db/schema";

/**
 * `DELETE /api/transactions/[id]` — soft void (`voided_at`), never a row
 * deletion (ADR-0004). The row stays in the table so the audit trail behind
 * a number the user acted on financially is always reconstructible.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid transaction id" }, { status: 400 });
  }

  const existingRows = await db.select().from(manualTransaction).where(eq(manualTransaction.id, id)).limit(1);
  const existing = existingRows[0];
  if (!existing) {
    return NextResponse.json({ error: `No transaction with id ${id}` }, { status: 404 });
  }
  if (existing.voidedAt !== null) {
    return NextResponse.json({ transaction: existing }, { status: 200 });
  }

  const updated = await db
    .update(manualTransaction)
    .set({ voidedAt: new Date() })
    .where(eq(manualTransaction.id, id))
    .returning();

  return NextResponse.json({ transaction: updated[0] }, { status: 200 });
}
