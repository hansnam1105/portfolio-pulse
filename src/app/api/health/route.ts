import { desc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { jobRun, providerCallLog } from "@/db/schema";

/**
 * `GET /api/health` — job freshness + per-provider last-success timestamp
 * (spec 0001 § Internal API surface). No secrets in the response, ever —
 * only job/provider status metadata is read here, never env vars or provider
 * response bodies.
 */
export async function GET(): Promise<Response> {
  const [lastJobRuns, lastCallsByProvider] = await Promise.all([
    db.select().from(jobRun).orderBy(desc(jobRun.runDate)).limit(5),
    db
      .select({
        provider: providerCallLog.provider,
        lastCalledAt: sql<string>`max(${providerCallLog.calledAt})`.as("last_called_at"),
        lastOk: sql<boolean>`bool_or(${providerCallLog.ok})`.as("last_ok"),
      })
      .from(providerCallLog)
      .groupBy(providerCallLog.provider),
  ]);

  return NextResponse.json({
    jobRuns: lastJobRuns.map((run) => ({
      jobName: run.jobName,
      runDate: run.runDate,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    })),
    providers: lastCallsByProvider,
  });
}
