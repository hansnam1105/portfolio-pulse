import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createDefaultJobDependencies, runDailyBriefingJob } from "@/lib/briefing/build";

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * `POST /api/jobs/daily-briefing` — runs/reruns the daily job. Guarded by
 * `Authorization: Bearer $CRON_SECRET` ONLY (spec 0001 v3 § Authentication —
 * there is no session, the "or an authenticated user session" alternative
 * from ADR-0003 is removed). A request without a valid bearer token is 401,
 * unconditionally. This is the one endpoint that spends provider quota, so it
 * is the one endpoint that still needs a secret.
 */
export async function POST(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Fail closed: an unset secret must never be treated as "no auth required".
    return NextResponse.json({ error: "Server is not configured with CRON_SECRET" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  if (!timingSafeEqualStrings(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runDailyBriefingJob(createDefaultJobDependencies());
  return NextResponse.json(summary, { status: summary.status === "failed" ? 502 : 200 });
}
