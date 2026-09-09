import "server-only";

/**
 * Orchestrates the daily briefing job (ADR-0003, spec 0001 § Job sequence):
 *
 *   1. claim job_run (job_name='daily-briefing', run_date=today) -- idempotent
 *   2. load current_holding -> securities[]
 *   3. fan out per provider, rate-limited, cache-first; a single non-Gemini
 *      provider failure is recorded in degraded_sources and does NOT abort
 *   4. assemble prompt inputs -> input_digest
 *   5. if a briefing for today exists with the same input_digest -> stop (no LLM call)
 *   6. ONE Gemini call, structured JSON, Zod-validated
 *   7. persist briefing + briefing_item rows in a transaction; status ok | partial
 *   8. close job_run
 *
 * All I/O is expressed through the `JobDependencies` interface so this
 * sequencing/idempotency/degradation logic is unit-testable with in-memory
 * fakes and zero network calls or live DATABASE_URL (spec 0001 § Files to
 * change: tests/**, "integration test for the job endpoint against
 * fixtures/mocks"). `createDefaultJobDependencies()` wires the real
 * Postgres + provider-gateway implementation used in production.
 */
import crypto from "node:crypto";
import {
  computeCurrentHolding,
  selectApplicableTransactions,
  type ManualTransactionInput,
  type SnapshotHoldingInput,
} from "@/lib/holdings/current";
import { toDecimal } from "@/lib/money";
import {
  buildBriefingPrompt,
  callGeminiForBriefing,
  DEFAULT_GEMINI_MODEL,
  PROMPT_VERSION,
  resolveCitedNewsKeys,
  type BriefingHoldingInput,
  type BriefingMacroInput,
  type BriefingNewsInput,
  type BuildBriefingPromptInput,
} from "@/lib/providers/gemini";
import { createDefaultGatewayDeps, type GatewayDeps } from "@/lib/providers/gateway";
import { fetchDartDisclosures } from "@/lib/providers/dart";
import { fetchLatestBaseRate, fetchLatestUsdKrwRate } from "@/lib/providers/ecos";
import { fetchFinnhubCompanyNews, fetchFinnhubQuote } from "@/lib/providers/finnhub";
import { fetchFmpProfile } from "@/lib/providers/fmp";
import { fetchKrxEtfDailyTrades, fetchKrxStockDailyTrades, findKrxClose, type KrxDailyResponse } from "@/lib/providers/krx";
import { fetchNaverNews } from "@/lib/providers/naver";
import { todayInSeoul } from "@/lib/dates";

export const JOB_NAME = "daily-briefing";

// ---------------------------------------------------------------------------
// Types shared across the job sequence
// ---------------------------------------------------------------------------

export interface HoldingForJob {
  securityId: number;
  market: "KRX" | "US";
  symbol: string;
  nameLocal: string;
  nameEn: string | null;
  currency: "KRW" | "USD";
  corpCode: string | null;
  snapshotAsOfDate: string | null;
  holding: SnapshotHoldingInput | null;
  transactions: readonly ManualTransactionInput[];
  priceAtAsOfDate: string | null;
  latestClose: string | null;
}

export interface FanOutResult {
  newsBySecurityId: Map<number, BriefingNewsInput[]>;
  macro: BriefingMacroInput;
  degradedSources: string[];
}

export interface ExistingBriefing {
  id: number;
  inputDigest: string | null;
}

export interface PersistBriefingInput {
  briefingDate: string;
  status: "ok" | "partial";
  model: string;
  promptVersion: string;
  inputDigest: string;
  overviewMd: string;
  tokenUsage: Record<string, unknown> | undefined;
  degradedSources: string[];
  items: {
    securityId: number;
    headline: string;
    bodyMd: string;
    sentiment: "positive" | "neutral" | "negative" | "unclear";
    citedNewsIds: number[];
  }[];
}

export interface JobDependencies {
  /** Asia/Seoul calendar date, YYYY-MM-DD. Injectable so tests are deterministic. */
  today(): string;
  claimJobRun(
    jobName: string,
    runDate: string,
  ): Promise<{ claimed: boolean; jobRunId: number; reason?: string }>;
  loadCurrentHoldings(): Promise<HoldingForJob[]>;
  fetchProviderData(holdings: HoldingForJob[]): Promise<FanOutResult>;
  getExistingBriefing(briefingDate: string): Promise<ExistingBriefing | null>;
  callGemini(input: BuildBriefingPromptInput): ReturnType<typeof callGeminiForBriefing>;
  persistBriefing(input: PersistBriefingInput): Promise<void>;
  closeJobRun(jobRunId: number, status: "ok" | "partial" | "failed", error?: string): Promise<void>;
}

export interface JobRunSummary {
  ran: boolean;
  reason?: string;
  status?: "ok" | "partial" | "failed";
  degradedSources?: string[];
  geminiCalled: boolean;
}

// ---------------------------------------------------------------------------
// Input digest — sha256 of the assembled prompt inputs (step 4/5)
// ---------------------------------------------------------------------------

export function computeInputDigest(input: BuildBriefingPromptInput): string {
  // Stable stringify: keys are already inserted in a fixed order by the
  // callers of this function, and JSON.stringify preserves insertion order
  // for string keys, so no extra normalization is needed here.
  const json = JSON.stringify(input);
  return crypto.createHash("sha256").update(json).digest("hex");
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function runDailyBriefingJob(deps: JobDependencies): Promise<JobRunSummary> {
  const runDate = deps.today();

  const claim = await deps.claimJobRun(JOB_NAME, runDate);
  if (!claim.claimed) {
    return { ran: false, reason: claim.reason ?? "job already running", geminiCalled: false };
  }

  try {
    // Step 2: current holdings (the daily job reads current_holding, not the
    // latest snapshot directly -- ADR-0004 §5).
    const holdings = await deps.loadCurrentHoldings();

    // Step 3: fan out, cache-first, rate-limited; failures degrade, not abort.
    const fanOut = await deps.fetchProviderData(holdings);

    // Step 4: assemble prompt inputs.
    const briefingHoldings: BriefingHoldingInput[] = holdings.map((h, index) => {
      const current = computeCurrentHolding({
        securityId: h.securityId,
        snapshotAsOfDate: h.snapshotAsOfDate,
        holding: h.holding,
        transactions: h.transactions,
        priceAtAsOfDate: h.priceAtAsOfDate,
        latestClose: h.latestClose,
      });
      const securityKey = `S${index + 1}`;
      const news = fanOut.newsBySecurityId.get(h.securityId) ?? [];

      if (current.status === "stale") {
        return {
          securityKey,
          nameLocal: h.nameLocal,
          nameEn: h.nameEn ?? undefined,
          market: h.market,
          quantityCurrent: "unavailable (stale as-of value)",
          quantityBasis: "estimated",
          valueCurrent: current.frozenValue.toFixed(),
          unrealizedPl: "unavailable",
          currency: h.currency,
          news,
        };
      }

      return {
        securityKey,
        nameLocal: h.nameLocal,
        nameEn: h.nameEn ?? undefined,
        market: h.market,
        quantityCurrent: current.quantityCurrent.toFixed(),
        quantityBasis: current.quantityBasis,
        valueCurrent: current.valueCurrent?.toFixed() ?? "unavailable",
        unrealizedPl: current.unrealizedPl?.toFixed() ?? "unavailable",
        currency: h.currency,
        news,
      };
    });

    const promptInput: BuildBriefingPromptInput = {
      briefingDate: runDate,
      lang: (process.env.BRIEFING_LANG as "ko" | "en" | undefined) ?? "ko",
      macro: fanOut.macro,
      holdings: briefingHoldings,
      degradedSources: fanOut.degradedSources,
    };
    const inputDigest = computeInputDigest(promptInput);

    // Step 5: skip the LLM call if nothing changed since the last attempt today.
    const existing = await deps.getExistingBriefing(runDate);
    if (existing && existing.inputDigest === inputDigest) {
      await deps.closeJobRun(
        claim.jobRunId,
        fanOut.degradedSources.length > 0 ? "partial" : "ok",
      );
      return {
        ran: true,
        status: fanOut.degradedSources.length > 0 ? "partial" : "ok",
        degradedSources: fanOut.degradedSources,
        geminiCalled: false,
        reason: "input unchanged since last run today",
      };
    }

    // Step 6: exactly one Gemini call.
    const geminiResult = await deps.callGemini(promptInput);

    if (!geminiResult.ok || !geminiResult.data) {
      await deps.closeJobRun(claim.jobRunId, "failed", geminiResult.error ?? "Gemini call failed");
      return { ran: true, status: "failed", degradedSources: fanOut.degradedSources, geminiCalled: true };
    }

    // Step 7: persist. Citations are re-validated against the news actually
    // fed to the model (see gemini.ts's resolveCitedNewsKeys doc comment).
    const newsKeyToId = new Map<string, number>();
    for (const list of fanOut.newsBySecurityId.values()) {
      for (const n of list) {
        // Populated by fetchProviderData's default implementation via a
        // parallel id map; see createDefaultFetchProviderData below.
        const id = (n as BriefingNewsInput & { __newsItemId?: number }).__newsItemId;
        if (id !== undefined) newsKeyToId.set(n.newsKey, id);
      }
    }

    const securityKeyToId = new Map<string, number>();
    briefingHoldings.forEach((h, index) => securityKeyToId.set(h.securityKey, holdings[index]!.securityId));

    const status = fanOut.degradedSources.length > 0 ? "partial" : "ok";

    await deps.persistBriefing({
      briefingDate: runDate,
      status,
      model: geminiResult.model,
      promptVersion: PROMPT_VERSION,
      inputDigest,
      overviewMd: geminiResult.data.overviewMd,
      tokenUsage: geminiResult.tokenUsage as Record<string, unknown> | undefined,
      degradedSources: fanOut.degradedSources,
      items: geminiResult.data.items.map((item) => {
        const securityId = securityKeyToId.get(item.securityKey);
        const validKeys = resolveCitedNewsKeys(
          item.citedNewsKeys,
          [...newsKeyToId.keys()],
        );
        return {
          securityId: securityId ?? -1,
          headline: item.headline,
          bodyMd: item.bodyMd,
          sentiment: item.sentiment,
          citedNewsIds: validKeys.map((k) => newsKeyToId.get(k)).filter((id): id is number => id !== undefined),
        };
      }).filter((item) => item.securityId !== -1),
    });

    // Step 8: close job_run.
    await deps.closeJobRun(claim.jobRunId, status);

    return { ran: true, status, degradedSources: fanOut.degradedSources, geminiCalled: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.closeJobRun(claim.jobRunId, "failed", message);
    return { ran: true, status: "failed", geminiCalled: false, reason: message };
  }
}

// ---------------------------------------------------------------------------
// Default (production) dependency wiring
// ---------------------------------------------------------------------------

async function defaultClaimJobRun(jobName: string, runDate: string) {
  const { db } = await import("@/db");
  const { jobRun } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");

  const existingRows = await db
    .select()
    .from(jobRun)
    .where(and(eq(jobRun.jobName, jobName), eq(jobRun.runDate, runDate)))
    .limit(1);
  const existing = existingRows[0];

  if (existing && existing.status === "running") {
    return { claimed: false, jobRunId: existing.id, reason: "job already running for this run_date" };
  }

  if (existing) {
    await db
      .update(jobRun)
      .set({ status: "running", startedAt: new Date(), finishedAt: null, error: null })
      .where(eq(jobRun.id, existing.id));
    return { claimed: true, jobRunId: existing.id };
  }

  const inserted = await db
    .insert(jobRun)
    .values({ jobName, runDate, status: "running", startedAt: new Date() })
    .returning({ id: jobRun.id });
  const insertedRow = inserted[0];
  if (!insertedRow) {
    throw new Error("Failed to claim job_run: insert returned no row");
  }
  return { claimed: true, jobRunId: insertedRow.id };
}

async function defaultCloseJobRun(jobRunId: number, status: "ok" | "partial" | "failed", error?: string) {
  const { db } = await import("@/db");
  const { jobRun } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  await db
    .update(jobRun)
    .set({ status, finishedAt: new Date(), error: error ?? null })
    .where(eq(jobRun.id, jobRunId));
}

async function defaultGetExistingBriefing(briefingDate: string): Promise<ExistingBriefing | null> {
  const { db } = await import("@/db");
  const { briefing } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db.select().from(briefing).where(eq(briefing.briefingDate, briefingDate)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, inputDigest: row.inputDigest };
}

async function defaultPersistBriefing(input: PersistBriefingInput): Promise<void> {
  const { db } = await import("@/db");
  const { briefing, briefingItem } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: briefing.id })
      .from(briefing)
      .where(eq(briefing.briefingDate, input.briefingDate))
      .limit(1);

    let briefingId: number;
    if (existing[0]) {
      briefingId = existing[0].id;
      await tx
        .update(briefing)
        .set({
          status: input.status,
          generatedAt: new Date(),
          model: input.model,
          promptVersion: input.promptVersion,
          inputDigest: input.inputDigest,
          overviewMd: input.overviewMd,
          tokenUsage: input.tokenUsage ?? null,
          degradedSources: input.degradedSources,
          error: null,
        })
        .where(eq(briefing.id, briefingId));
      await tx.delete(briefingItem).where(eq(briefingItem.briefingId, briefingId));
    } else {
      const inserted = await tx
        .insert(briefing)
        .values({
          briefingDate: input.briefingDate,
          status: input.status,
          generatedAt: new Date(),
          model: input.model,
          promptVersion: input.promptVersion,
          inputDigest: input.inputDigest,
          overviewMd: input.overviewMd,
          tokenUsage: input.tokenUsage ?? null,
          degradedSources: input.degradedSources,
        })
        .returning({ id: briefing.id });
      const insertedRow = inserted[0];
      if (!insertedRow) throw new Error("Failed to insert briefing: insert returned no row");
      briefingId = insertedRow.id;
    }

    if (input.items.length > 0) {
      await tx.insert(briefingItem).values(
        input.items.map((item) => ({
          briefingId,
          securityId: item.securityId,
          headline: item.headline,
          bodyMd: item.bodyMd,
          sentiment: item.sentiment,
          citedNewsIds: item.citedNewsIds,
        })),
      );
    }
  });
}

async function defaultLoadCurrentHoldings(): Promise<HoldingForJob[]> {
  const { db } = await import("@/db");
  const { security, portfolioSnapshot, holding, manualTransaction, priceDaily } = await import(
    "@/db/schema"
  );
  const { desc, eq, isNull } = await import("drizzle-orm");

  const latestSnapshotRows = await db
    .select()
    .from(portfolioSnapshot)
    .orderBy(desc(portfolioSnapshot.asOfDate), desc(portfolioSnapshot.uploadedAt))
    .limit(1);
  const latestSnapshot = latestSnapshotRows[0] ?? null;

  const holdingRows = latestSnapshot
    ? await db.select().from(holding).where(eq(holding.snapshotId, latestSnapshot.id))
    : [];

  const allSecurities = await db.select().from(security);
  const allTransactions = await db
    .select()
    .from(manualTransaction)
    .where(isNull(manualTransaction.voidedAt));

  const securityIdsWithActivity = new Set<number>([
    ...holdingRows.map((h) => h.securityId),
    ...allTransactions
      .filter((t) => t.supersededBySnapshotId === null)
      .map((t) => t.securityId),
  ]);

  const result: HoldingForJob[] = [];
  for (const securityId of securityIdsWithActivity) {
    const sec = allSecurities.find((s) => s.id === securityId);
    if (!sec) continue;
    const h = holdingRows.find((row) => row.securityId === securityId) ?? null;
    const transactions = allTransactions
      .filter((t) => t.securityId === securityId)
      .map((t): ManualTransactionInput => ({
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

    let priceAtAsOfDate: string | null = null;
    let latestClose: string | null = null;
    if (latestSnapshot) {
      const priceRows = await db
        .select()
        .from(priceDaily)
        .where(eq(priceDaily.securityId, securityId));
      const asOfRow = priceRows.find((p) => p.tradeDate === latestSnapshot.asOfDate);
      priceAtAsOfDate = asOfRow?.close ?? null;
      const latestRow = priceRows.sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : -1))[0];
      latestClose = latestRow?.close ?? null;
    }

    result.push({
      securityId,
      market: sec.market,
      symbol: sec.symbol,
      nameLocal: sec.nameLocal,
      nameEn: sec.nameEn,
      currency: sec.currency,
      corpCode: sec.corpCode,
      snapshotAsOfDate: latestSnapshot?.asOfDate ?? null,
      holding: h
        ? {
            quantity: h.quantity,
            costBasisTotal: h.costBasisTotal,
            marketValueAtUpload: h.marketValueAtUpload,
            currency: h.currency,
          }
        : null,
      transactions,
      priceAtAsOfDate,
      latestClose,
    });
  }

  return result;
}

/**
 * Persists a fetched article as `news_item` (deduped on `url_sha256`) and
 * links it to `security_id` via `news_link` (spec 0001 § Job sequence step 3:
 * "DART/Naver/Finnhub -> news_item + news_link"). Returns the news_item id so
 * the model's citations can be mapped back to a real database id.
 */
async function persistNewsItemAndLink(item: {
  kind: "news" | "disclosure";
  source: "finnhub" | "naver" | "dart";
  url: string;
  title: string;
  summary?: string;
  lang: "ko" | "en";
  publishedAt: string;
  raw: Record<string, unknown>;
  securityId: number;
}): Promise<number> {
  const { db } = await import("@/db");
  const { newsItem, newsLink } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const crypto_ = await import("node:crypto");

  const urlSha256 = crypto_.createHash("sha256").update(item.url).digest("hex");

  const existing = await db.select().from(newsItem).where(eq(newsItem.urlSha256, urlSha256)).limit(1);
  let newsItemId: number;
  if (existing[0]) {
    newsItemId = existing[0].id;
  } else {
    const inserted = await db
      .insert(newsItem)
      .values({
        kind: item.kind,
        source: item.source,
        url: item.url,
        urlSha256,
        title: item.title,
        summary: item.summary,
        lang: item.lang,
        publishedAt: new Date(item.publishedAt),
        raw: item.raw,
      })
      .onConflictDoNothing({ target: newsItem.urlSha256 })
      .returning({ id: newsItem.id });
    if (inserted[0]) {
      newsItemId = inserted[0].id;
    } else {
      // Lost a race with a concurrent insert; re-select.
      const raceRows = await db.select().from(newsItem).where(eq(newsItem.urlSha256, urlSha256)).limit(1);
      const raceRow = raceRows[0];
      if (!raceRow) throw new Error("Failed to persist news_item");
      newsItemId = raceRow.id;
    }
  }

  await db
    .insert(newsLink)
    .values({ newsItemId, securityId: item.securityId, relevance: "primary" })
    .onConflictDoNothing({ target: [newsLink.newsItemId, newsLink.securityId] });

  return newsItemId;
}

async function upsertPriceDaily(row: {
  securityId: number;
  tradeDate: string;
  close: string;
  prevClose?: string | null;
  currency: "KRW" | "USD";
  source: string;
}): Promise<void> {
  const { db } = await import("@/db");
  const { priceDaily } = await import("@/db/schema");
  await db
    .insert(priceDaily)
    .values({
      securityId: row.securityId,
      tradeDate: row.tradeDate,
      close: row.close,
      prevClose: row.prevClose ?? null,
      currency: row.currency,
      source: row.source,
    })
    .onConflictDoUpdate({
      target: [priceDaily.securityId, priceDaily.tradeDate],
      set: { close: row.close, prevClose: row.prevClose ?? null, source: row.source },
    });
}

async function upsertFxRateDaily(row: {
  pair: string;
  rateDate: string;
  rate: string;
  source: string;
}): Promise<void> {
  const { db } = await import("@/db");
  const { fxRateDaily } = await import("@/db/schema");
  await db
    .insert(fxRateDaily)
    .values(row)
    .onConflictDoUpdate({
      target: [fxRateDaily.pair, fxRateDaily.rateDate],
      set: { rate: row.rate, source: row.source },
    });
}

async function upsertMacroObservation(row: {
  seriesCode: string;
  obsDate: string;
  value: string;
  unit: string;
  source: string;
}): Promise<void> {
  const { db } = await import("@/db");
  const { macroObservation } = await import("@/db/schema");
  await db
    .insert(macroObservation)
    .values(row)
    .onConflictDoUpdate({
      target: [macroObservation.seriesCode, macroObservation.obsDate],
      set: { value: row.value, unit: row.unit, source: row.source },
    });
}

/** Default provider fan-out: cache-first, rate-limited, degrades rather than
 * aborts. Persists price_daily/fx_rate_daily/macro_observation/news_item/
 * news_link as it goes (spec 0001 § Job sequence step 3), in addition to
 * assembling the prompt-ready news list this function returns. */
async function defaultFetchProviderData(
  holdings: HoldingForJob[],
  gatewayDeps: GatewayDeps,
): Promise<FanOutResult> {
  const degradedSources = new Set<string>();
  const newsBySecurityId = new Map<number, BriefingNewsInput[]>();
  const today = todayInSeoul();
  let newsKeyCounter = 0;
  const nextNewsKey = () => `N${++newsKeyCounter}`;

  const pushNews = (
    list: BriefingNewsInput[],
    id: number,
    entry: BriefingNewsInput,
  ) => {
    list.push(Object.assign(entry, { __newsItemId: id }));
  };

  // Macro context (ECOS) -- once per job, not per holding.
  // Stat/item codes (722Y001/0101000 base rate, 731Y001/0000001 USD/KRW)
  // confirmed correct against ECOS's own StatisticItemList catalog
  // (2026-09-10). The failure mode was requesting the current, not-yet-
  // published month/day — fetchLatestBaseRate/fetchLatestUsdKrwRate walk
  // backwards to the most recently published period instead.
  const macro: BriefingMacroInput = {};
  try {
    const monthCompact = today.slice(0, 7).replace("-", "");
    const baseRateResult = await fetchLatestBaseRate(gatewayDeps, monthCompact);
    if (baseRateResult.ok && baseRateResult.data) {
      const row = baseRateResult.data.StatisticSearch.row[0];
      if (row) {
        macro.baseRate = row.DATA_VALUE;
        await upsertMacroObservation({
          seriesCode: row.STAT_CODE,
          obsDate: today,
          value: row.DATA_VALUE,
          unit: row.UNIT_NAME,
          source: "ecos",
        });
      }
    } else {
      degradedSources.add("ecos");
    }
  } catch {
    degradedSources.add("ecos");
  }

  try {
    const dayCompact = today.replace(/-/g, "");
    const fxResult = await fetchLatestUsdKrwRate(gatewayDeps, dayCompact);
    if (fxResult.ok && fxResult.data) {
      const row = fxResult.data.StatisticSearch.row[0];
      if (row) {
        macro.usdKrw = row.DATA_VALUE;
        const rateDate = `${row.TIME.slice(0, 4)}-${row.TIME.slice(4, 6)}-${row.TIME.slice(6, 8)}`;
        await upsertFxRateDaily({
          pair: "USDKRW",
          rateDate,
          rate: row.DATA_VALUE,
          source: "ecos",
        });
      }
    } else {
      degradedSources.add("ecos");
    }
  } catch {
    degradedSources.add("ecos");
  }

  // KRX has no per-ticker query param — each product's OutBlock_1 is the
  // WHOLE day's market, so fetch each product once for the whole portfolio
  // rather than once per holding (see src/lib/providers/krx.ts). Two
  // separate products because 유가증권 일별매매정보 (stock) doesn't cover
  // ETF-listed securities; a holding may match either or neither.
  let krxStockData: KrxDailyResponse | null = null;
  let krxEtfData: KrxDailyResponse | null = null;
  if (holdings.some((h) => h.market === "KRX")) {
    try {
      const stockResult = await fetchKrxStockDailyTrades(gatewayDeps, { tradeDate: today });
      if (stockResult.ok && stockResult.data) krxStockData = stockResult.data;
    } catch {
      // a null result here just means the stock lookup below misses;
      // the ETF product is tried independently.
    }
    try {
      const etfResult = await fetchKrxEtfDailyTrades(gatewayDeps, { tradeDate: today });
      if (etfResult.ok && etfResult.data) krxEtfData = etfResult.data;
    } catch {
      // see above
    }
  }

  for (const h of holdings) {
    const newsForSecurity: BriefingNewsInput[] = [];

    if (h.market === "KRX") {
      const krxMatch =
        (krxStockData && findKrxClose(krxStockData, h.symbol)) ??
        (krxEtfData && findKrxClose(krxEtfData, h.symbol)) ??
        null;
      if (krxMatch) {
        await upsertPriceDaily({
          securityId: h.securityId,
          tradeDate: krxMatch.tradeDate,
          close: krxMatch.close,
          prevClose: krxMatch.prevClose,
          currency: "KRW",
          source: "krx",
        });
      } else {
        degradedSources.add("krx");
      }

      if (h.corpCode) {
        try {
          const dartResult = await fetchDartDisclosures(gatewayDeps, {
            corpCode: h.corpCode,
            beginDate: today,
            endDate: today,
          });
          if (dartResult.ok && dartResult.data) {
            for (const item of dartResult.data.list) {
              const url = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`;
              const id = await persistNewsItemAndLink({
                kind: "disclosure",
                source: "dart",
                url,
                title: item.report_nm,
                lang: "ko",
                publishedAt: item.rcept_dt,
                raw: item,
                securityId: h.securityId,
              });
              pushNews(newsForSecurity, id, {
                newsKey: nextNewsKey(),
                title: item.report_nm,
                lang: "ko",
                source: "dart",
                publishedAt: item.rcept_dt,
              });
            }
          } else {
            degradedSources.add("dart");
          }
        } catch {
          degradedSources.add("dart");
        }
      }

      try {
        const naverResult = await fetchNaverNews(gatewayDeps, { query: h.nameLocal, display: 5 });
        if (naverResult.ok && naverResult.data) {
          for (const item of naverResult.data.items) {
            const title = item.title.replace(/<\/?b>/g, "");
            const summary = item.description.replace(/<\/?b>/g, "");
            const id = await persistNewsItemAndLink({
              kind: "news",
              source: "naver",
              url: item.originallink || item.link,
              title,
              summary,
              lang: "ko",
              publishedAt: item.pubDate,
              raw: item,
              securityId: h.securityId,
            });
            pushNews(newsForSecurity, id, {
              newsKey: nextNewsKey(),
              title,
              summary,
              lang: "ko",
              source: "naver",
              publishedAt: item.pubDate,
            });
          }
        } else {
          degradedSources.add("naver");
        }
      } catch {
        degradedSources.add("naver");
      }
    } else {
      try {
        const quoteResult = await fetchFinnhubQuote(gatewayDeps, h.symbol);
        if (quoteResult.ok && quoteResult.data) {
          await upsertPriceDaily({
            securityId: h.securityId,
            tradeDate: today,
            close: String(quoteResult.data.c),
            prevClose: String(quoteResult.data.pc),
            currency: "USD",
            source: "finnhub",
          });
        } else {
          degradedSources.add("finnhub");
        }
      } catch {
        degradedSources.add("finnhub");
      }

      try {
        const newsResult = await fetchFinnhubCompanyNews(gatewayDeps, { symbol: h.symbol, from: today, to: today });
        if (newsResult.ok && newsResult.data) {
          for (const item of newsResult.data) {
            const publishedAt = new Date(item.datetime * 1000).toISOString();
            const id = await persistNewsItemAndLink({
              kind: "news",
              source: "finnhub",
              url: item.url,
              title: item.headline,
              summary: item.summary,
              lang: "en",
              publishedAt,
              raw: item,
              securityId: h.securityId,
            });
            pushNews(newsForSecurity, id, {
              newsKey: nextNewsKey(),
              title: item.headline,
              summary: item.summary,
              lang: "en",
              source: "finnhub",
              publishedAt,
            });
          }
        } else {
          degradedSources.add("finnhub");
        }
      } catch {
        degradedSources.add("finnhub");
      }

      try {
        const profileResult = await fetchFmpProfile(gatewayDeps, h.symbol);
        if (!profileResult.ok) degradedSources.add("fmp");
      } catch {
        degradedSources.add("fmp");
      }
    }

    newsBySecurityId.set(h.securityId, newsForSecurity);
  }

  return { newsBySecurityId, macro, degradedSources: [...degradedSources] };
}

export function createDefaultJobDependencies(): JobDependencies {
  const gatewayDeps = createDefaultGatewayDeps();
  return {
    today: todayInSeoul,
    claimJobRun: defaultClaimJobRun,
    loadCurrentHoldings: defaultLoadCurrentHoldings,
    fetchProviderData: (holdings) => defaultFetchProviderData(holdings, gatewayDeps),
    getExistingBriefing: defaultGetExistingBriefing,
    callGemini: (input) => callGeminiForBriefing(input),
    persistBriefing: defaultPersistBriefing,
    closeJobRun: defaultCloseJobRun,
  };
}

export { buildBriefingPrompt, DEFAULT_GEMINI_MODEL, selectApplicableTransactions };
