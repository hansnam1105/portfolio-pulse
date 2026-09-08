import { describe, it, expect } from "bun:test";
import {
  computeInputDigest,
  runDailyBriefingJob,
  type ExistingBriefing,
  type FanOutResult,
  type HoldingForJob,
  type JobDependencies,
  type PersistBriefingInput,
} from "@/lib/briefing/build";
import type { BriefingHoldingInput, BuildBriefingPromptInput, GeminiBriefingResult } from "@/lib/providers/gemini";

/**
 * Integration-style test for the daily-briefing job (spec 0001 § Job
 * sequence), exercised entirely through `runDailyBriefingJob`'s injected
 * `JobDependencies` — the same seam `src/app/api/jobs/daily-briefing/route.ts`
 * uses in production via `createDefaultJobDependencies()`. No real database
 * or provider/Gemini network call is made anywhere in this file.
 */

const HOLDING: HoldingForJob = {
  securityId: 1,
  market: "KRX",
  symbol: "000001",
  nameLocal: "가나전자",
  nameEn: null,
  currency: "KRW",
  corpCode: null,
  snapshotAsOfDate: "2026-09-01",
  holding: { quantity: "10", costBasisTotal: "1000", marketValueAtUpload: "1100", currency: "KRW" },
  transactions: [],
  priceAtAsOfDate: null,
  latestClose: "120",
};

interface FakeWorld {
  deps: JobDependencies;
  geminiCallCount: () => number;
  briefingRows: () => PersistBriefingInput[];
  closeCalls: () => { jobRunId: number; status: string; error?: string }[];
}

function buildFakeDeps(options: {
  runDate?: string;
  degradedSources?: string[];
  holdings?: HoldingForJob[];
} = {}): FakeWorld {
  const runDate = options.runDate ?? "2026-09-08";
  const holdings = options.holdings ?? [HOLDING];
  const degradedSources = options.degradedSources ?? [];

  let geminiCallCount = 0;
  const briefingRows: PersistBriefingInput[] = [];
  const closeCalls: { jobRunId: number; status: string; error?: string }[] = [];
  let jobRunIdCounter = 0;

  const deps: JobDependencies = {
    today: () => runDate,
    claimJobRun: async () => ({ claimed: true, jobRunId: ++jobRunIdCounter }),
    loadCurrentHoldings: async () => holdings,
    fetchProviderData: async (): Promise<FanOutResult> => ({
      newsBySecurityId: new Map(holdings.map((h) => [h.securityId, []])),
      macro: { baseRate: "3.50" },
      degradedSources,
    }),
    getExistingBriefing: async (briefingDate: string): Promise<ExistingBriefing | null> => {
      const existing = briefingRows.find((r) => r.briefingDate === briefingDate);
      if (!existing) return null;
      return { id: 1, inputDigest: existing.inputDigest };
    },
    callGemini: async (input: BuildBriefingPromptInput): Promise<GeminiBriefingResult> => {
      geminiCallCount += 1;
      return {
        ok: true,
        model: "gemini-3.6-flash",
        data: {
          overviewMd: "Overview",
          items: input.holdings.map((h: BriefingHoldingInput) => ({
            securityKey: h.securityKey,
            headline: "Headline",
            bodyMd: "Body",
            sentiment: "neutral" as const,
            citedNewsKeys: [],
          })),
        },
        tokenUsage: { totalTokenCount: 100 },
      };
    },
    persistBriefing: async (input: PersistBriefingInput) => {
      const index = briefingRows.findIndex((r) => r.briefingDate === input.briefingDate);
      if (index >= 0) briefingRows[index] = input;
      else briefingRows.push(input);
    },
    closeJobRun: async (jobRunId, status, error) => {
      closeCalls.push({ jobRunId, status, error });
    },
  };

  return {
    deps,
    geminiCallCount: () => geminiCallCount,
    briefingRows: () => briefingRows,
    closeCalls: () => closeCalls,
  };
}

describe("computeInputDigest", () => {
  it("is deterministic for identical inputs", () => {
    const input: BuildBriefingPromptInput = {
      briefingDate: "2026-09-08",
      lang: "ko",
      macro: {},
      holdings: [],
      degradedSources: [],
    };
    expect(computeInputDigest(input)).toBe(computeInputDigest(structuredClone(input)));
  });

  it("differs when the input differs", () => {
    const a: BuildBriefingPromptInput = { briefingDate: "2026-09-08", lang: "ko", macro: {}, holdings: [], degradedSources: [] };
    const b: BuildBriefingPromptInput = { ...a, degradedSources: ["krx"] };
    expect(computeInputDigest(a)).not.toBe(computeInputDigest(b));
  });
});

describe("runDailyBriefingJob — idempotency", () => {
  it("running the job twice for the same date with unchanged inputs makes at most one Gemini call and leaves exactly one briefing row", async () => {
    const world = buildFakeDeps();

    const first = await runDailyBriefingJob(world.deps);
    expect(first.ran).toBe(true);
    expect(first.geminiCalled).toBe(true);
    expect(first.status).toBe("ok");
    expect(world.geminiCallCount()).toBe(1);
    expect(world.briefingRows()).toHaveLength(1);

    const second = await runDailyBriefingJob(world.deps);
    expect(second.ran).toBe(true);
    expect(second.geminiCalled).toBe(false);
    expect(second.reason).toBe("input unchanged since last run today");

    // Still exactly one Gemini call and exactly one briefing row across both runs.
    expect(world.geminiCallCount()).toBe(1);
    expect(world.briefingRows()).toHaveLength(1);

    // Both runs close the job_run.
    expect(world.closeCalls()).toHaveLength(2);
    expect(world.closeCalls().every((c) => c.status === "ok")).toBe(true);
  });

  it("a changed input (e.g. a new degraded source) after the first run DOES trigger a second Gemini call", async () => {
    const world = buildFakeDeps({ degradedSources: [] });
    await runDailyBriefingJob(world.deps);
    expect(world.geminiCallCount()).toBe(1);

    // Mutate the fake world's degraded sources between runs, like a provider
    // failing on the second attempt would.
    const changedWorld = buildFakeDeps({ degradedSources: ["naver"] });
    // Reuse the same "existing briefing" state to simulate a same-day rerun.
    (changedWorld.deps as unknown as { getExistingBriefing: JobDependencies["getExistingBriefing"] }).getExistingBriefing =
      async () => ({ id: 1, inputDigest: computeInputDigest({
        briefingDate: "2026-09-08",
        lang: "ko",
        macro: { baseRate: "3.50" },
        holdings: [
          {
            securityKey: "S1",
            nameLocal: HOLDING.nameLocal,
            market: HOLDING.market,
            quantityCurrent: "10",
            quantityBasis: "exact",
            valueCurrent: "1200",
            unrealizedPl: "200",
            currency: HOLDING.currency,
            news: [],
          },
        ],
        degradedSources: [],
      }) });

    const result = await runDailyBriefingJob(changedWorld.deps);
    expect(result.geminiCalled).toBe(true);
    expect(result.status).toBe("partial");
    expect(changedWorld.geminiCallCount()).toBe(1);
  });
});

describe("runDailyBriefingJob — provider degradation does not abort the job", () => {
  it("a single degraded provider source is recorded in degradedSources and the job still completes with status 'partial'", async () => {
    const world = buildFakeDeps({ degradedSources: ["krx"] });
    const result = await runDailyBriefingJob(world.deps);

    expect(result.ran).toBe(true);
    expect(result.status).toBe("partial");
    expect(result.degradedSources).toEqual(["krx"]);
    expect(result.geminiCalled).toBe(true); // a degraded source must not skip the LLM call

    expect(world.briefingRows()).toHaveLength(1);
    expect(world.briefingRows()[0]?.status).toBe("partial");
    expect(world.briefingRows()[0]?.degradedSources).toEqual(["krx"]);

    expect(world.closeCalls()).toHaveLength(1);
    expect(world.closeCalls()[0]?.status).toBe("partial");
  });

  it("no degraded sources yields status 'ok'", async () => {
    const world = buildFakeDeps({ degradedSources: [] });
    const result = await runDailyBriefingJob(world.deps);
    expect(result.status).toBe("ok");
    expect(world.briefingRows()[0]?.status).toBe("ok");
  });
});

describe("runDailyBriefingJob — claim / failure handling", () => {
  it("does not run when the job_run claim fails (already running)", async () => {
    const world = buildFakeDeps();
    const deps: JobDependencies = {
      ...world.deps,
      claimJobRun: async () => ({ claimed: false, jobRunId: 1, reason: "job already running for this run_date" }),
    };
    const result = await runDailyBriefingJob(deps);
    expect(result.ran).toBe(false);
    expect(result.reason).toBe("job already running for this run_date");
    expect(result.geminiCalled).toBe(false);
    expect(world.geminiCallCount()).toBe(0);
  });

  it("a thrown error anywhere in the sequence is caught, closes the job_run as 'failed', and never propagates", async () => {
    const world = buildFakeDeps();
    const deps: JobDependencies = {
      ...world.deps,
      loadCurrentHoldings: async () => {
        throw new Error("db unreachable");
      },
    };
    const result = await runDailyBriefingJob(deps);
    expect(result.ran).toBe(true);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("db unreachable");
    expect(world.closeCalls()).toHaveLength(1);
    expect(world.closeCalls()[0]?.status).toBe("failed");
    expect(world.closeCalls()[0]?.error).toBe("db unreachable");
  });

  it("a failed Gemini call closes the job_run as 'failed' without persisting a briefing", async () => {
    const world = buildFakeDeps();
    const deps: JobDependencies = {
      ...world.deps,
      callGemini: async () => ({ ok: false, model: "gemini-3.6-flash", error: "Gemini returned HTTP 500" }),
    };
    const result = await runDailyBriefingJob(deps);
    expect(result.status).toBe("failed");
    expect(result.geminiCalled).toBe(true);
    expect(world.briefingRows()).toHaveLength(0);
    expect(world.closeCalls()[0]?.status).toBe("failed");
  });
});
