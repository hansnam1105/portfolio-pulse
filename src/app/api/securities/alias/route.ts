import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { security, securityAlias } from "@/db/schema";

/**
 * `POST /api/securities/alias` — resolve an `unresolved` upload-preview row
 * by binding a raw export label to a security (spec 0001 § Internal API
 * surface). Expected to be used routinely, since the export gives no ticker
 * code (spec 0001 § Parser profile).
 */
const bodySchema = z.object({
  rawLabel: z.string().min(1),
  securityId: z.number().int().positive(),
  note: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const securityRows = await db.select().from(security).where(eq(security.id, parsed.data.securityId)).limit(1);
  if (securityRows.length === 0) {
    return NextResponse.json({ error: `No security with id ${parsed.data.securityId}` }, { status: 404 });
  }

  const existing = await db
    .select()
    .from(securityAlias)
    .where(eq(securityAlias.rawLabel, parsed.data.rawLabel))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: `Raw label '${parsed.data.rawLabel}' is already aliased to security ${existing[0]!.securityId}` },
      { status: 409 },
    );
  }

  const inserted = await db
    .insert(securityAlias)
    .values({ rawLabel: parsed.data.rawLabel, securityId: parsed.data.securityId, note: parsed.data.note })
    .returning();

  return NextResponse.json({ alias: inserted[0] }, { status: 201 });
}
