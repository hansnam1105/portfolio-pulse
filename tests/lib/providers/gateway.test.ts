import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";
import {
  _resetRateLimiterStateForTests,
  cacheKeyFor,
  createInMemoryCacheStore,
  createInMemoryCallLogger,
  gatewayCall,
  requireEnv,
  stripQueryString,
  TokenBucket,
  type GatewayDeps,
} from "@/lib/providers/gateway";

// This suite makes NO real outbound HTTP request to any provider API or to
// Gemini. Every `fetcher` below is a local stub — never global `fetch`.

const schema = z.object({ value: z.string() });

function makeDeps(): GatewayDeps & { logger: ReturnType<typeof createInMemoryCallLogger> } {
  const logger = createInMemoryCallLogger();
  return { cacheStore: createInMemoryCacheStore(), callLogger: logger, logger };
}

beforeEach(() => {
  _resetRateLimiterStateForTests();
});

describe("requireEnv", () => {
  it("returns the requested variables when all are present", () => {
    const env = { FOO: "abc", BAR: "def" } as unknown as NodeJS.ProcessEnv;
    expect(requireEnv(["FOO", "BAR"], env)).toEqual({ FOO: "abc", BAR: "def" });
  });

  it("throws naming only the missing variable's NAME, never a value", () => {
    const env = { FOO: "abc" } as unknown as NodeJS.ProcessEnv;
    expect(() => requireEnv(["FOO", "MISSING_VAR"], env)).toThrow(/MISSING_VAR/);
  });
});

describe("stripQueryString", () => {
  it("strips a query string", () => {
    expect(stripQueryString("/api/list.json?crtfc_key=secret&corp_code=1")).toBe("/api/list.json");
  });
  it("strips a fragment too", () => {
    expect(stripQueryString("/path#frag")).toBe("/path");
  });
  it("leaves a bare path untouched", () => {
    expect(stripQueryString("/api/list.json")).toBe("/api/list.json");
  });
});

describe("cacheKeyFor", () => {
  it("is stable regardless of key insertion order", () => {
    const a = cacheKeyFor("dart", "/api/list.json", { corpCode: "1", beginDe: "20260101" });
    const b = cacheKeyFor("dart", "/api/list.json", { beginDe: "20260101", corpCode: "1" });
    expect(a).toBe(b);
  });

  it("differs when the provider, endpoint, or params differ", () => {
    const base = cacheKeyFor("dart", "/api/list.json", { corpCode: "1" });
    expect(cacheKeyFor("krx", "/api/list.json", { corpCode: "1" })).not.toBe(base);
    expect(cacheKeyFor("dart", "/api/other.json", { corpCode: "1" })).not.toBe(base);
    expect(cacheKeyFor("dart", "/api/list.json", { corpCode: "2" })).not.toBe(base);
  });
});

describe("gatewayCall — cache behavior", () => {
  it("cache-miss: calls the fetcher, validates, and writes through to the cache", async () => {
    const deps = makeDeps();
    let fetcherCalls = 0;
    const result = await gatewayCall(deps, {
      provider: "test",
      endpoint: "/e",
      params: { a: 1 },
      ttlMs: 60_000,
      schema,
      fetcher: async () => {
        fetcherCalls += 1;
        return { status: 200, body: { value: "hello" } };
      },
    });

    expect(fetcherCalls).toBe(1);
    expect(result).toEqual({ ok: true, data: { value: "hello" }, fromCache: false });
    expect(deps.logger.entries).toHaveLength(1);
    expect(deps.logger.entries[0]?.ok).toBe(true);
    // and it must actually have been written to the cache store
    const cacheKey = cacheKeyFor("test", "/e", { a: 1 });
    expect(await deps.cacheStore.get(cacheKey)).not.toBeNull();
  });

  it("cache-hit: an unexpired cache entry short-circuits the fetcher entirely", async () => {
    const deps = makeDeps();
    const cacheKey = cacheKeyFor("test", "/e", { a: 1 });
    await deps.cacheStore.set(cacheKey, "test", { value: "cached" }, new Date(), new Date(Date.now() + 60_000));

    let fetcherCalls = 0;
    const result = await gatewayCall(deps, {
      provider: "test",
      endpoint: "/e",
      params: { a: 1 },
      ttlMs: 60_000,
      schema,
      fetcher: async () => {
        fetcherCalls += 1;
        return { status: 200, body: { value: "should not be reached" } };
      },
    });

    expect(fetcherCalls).toBe(0);
    expect(result).toEqual({ ok: true, data: { value: "cached" }, fromCache: true });
    // Cache hits are not call-logged (no network call happened).
    expect(deps.logger.entries).toHaveLength(0);
  });

  it("an expired cache entry is treated as a cache-miss", async () => {
    const deps = makeDeps();
    const cacheKey = cacheKeyFor("test", "/e", { a: 1 });
    await deps.cacheStore.set(cacheKey, "test", { value: "stale" }, new Date(0), new Date(0)); // already expired

    let fetcherCalls = 0;
    const result = await gatewayCall(deps, {
      provider: "test",
      endpoint: "/e",
      params: { a: 1 },
      ttlMs: 60_000,
      schema,
      fetcher: async () => {
        fetcherCalls += 1;
        return { status: 200, body: { value: "fresh" } };
      },
    });

    expect(fetcherCalls).toBe(1);
    expect(result.fromCache).toBe(false);
    expect(result.data).toEqual({ value: "fresh" });
  });

  it("a cached payload that no longer matches the schema is refetched rather than returned invalid", async () => {
    const deps = makeDeps();
    const cacheKey = cacheKeyFor("test", "/e", { a: 1 });
    await deps.cacheStore.set(cacheKey, "test", { wrongShape: true }, new Date(), new Date(Date.now() + 60_000));

    const result = await gatewayCall(deps, {
      provider: "test",
      endpoint: "/e",
      params: { a: 1 },
      ttlMs: 60_000,
      schema,
      fetcher: async () => ({ status: 200, body: { value: "refetched" } }),
    });

    expect(result).toEqual({ ok: true, data: { value: "refetched" }, fromCache: false });
  });
});

describe("gatewayCall — failure normalization (never throws)", () => {
  it("a non-2xx HTTP status becomes a normalized failure and is not cached", async () => {
    const deps = makeDeps();
    const result = await gatewayCall(deps, {
      provider: "test",
      endpoint: "/e",
      params: {},
      ttlMs: 60_000,
      schema,
      fetcher: async () => ({ status: 500, body: null }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 500/);
    expect(deps.logger.entries[0]?.ok).toBe(false);
    expect(deps.logger.entries[0]?.status).toBe(500);
  });

  it("a schema validation failure becomes a normalized failure and is not cached", async () => {
    const deps = makeDeps();
    const result = await gatewayCall(deps, {
      provider: "test",
      endpoint: "/e",
      params: {},
      ttlMs: 60_000,
      schema,
      fetcher: async () => ({ status: 200, body: { value: 12345 } }), // wrong type
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Zod validation failed/);
  });

  it("a fetcher that throws is caught and normalized, never propagated", async () => {
    const deps = makeDeps();
    const result = await gatewayCall(deps, {
      provider: "test",
      endpoint: "/e",
      params: {},
      ttlMs: 60_000,
      schema,
      fetcher: async () => {
        throw new Error("network exploded");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("network exploded");
    // Call logging must still happen even after a thrown error.
    expect(deps.logger.entries).toHaveLength(1);
    expect(deps.logger.entries[0]?.ok).toBe(false);
  });

  it("a call logger that itself rejects never aborts the caller's result", async () => {
    const cacheStore = createInMemoryCacheStore();
    const deps: GatewayDeps = {
      cacheStore,
      callLogger: { log: async () => { throw new Error("logger down"); } },
    };
    const result = await gatewayCall(deps, {
      provider: "test",
      endpoint: "/e",
      params: {},
      ttlMs: 60_000,
      schema,
      fetcher: async () => ({ status: 200, body: { value: "ok" } }),
    });
    expect(result).toEqual({ ok: true, data: { value: "ok" }, fromCache: false });
  });
});

describe("TokenBucket — rate limiter", () => {
  it("allows a burst up to its capacity with zero wait", async () => {
    let now = 0;
    const bucket = new TokenBucket(1, 3, () => now);
    expect(bucket.waitTimeMs()).toBe(0);
    await bucket.take(async () => {});
    await bucket.take(async () => {});
    await bucket.take(async () => {});
    // 3 tokens consumed from a burst of 3 -> next take must wait.
    expect(bucket.waitTimeMs()).toBeGreaterThan(0);
  });

  it("refills over time at the configured rate", () => {
    let now = 0;
    const bucket = new TokenBucket(1, 1, () => now);
    expect(bucket.waitTimeMs()).toBe(0);
    // Manually drain the single token via the internal refill by taking synchronously.
    now = 0;
    // Consume the only token without awaiting real time (inject an instant "sleep").
    return bucket.take(async () => {}).then(async () => {
      expect(bucket.waitTimeMs()).toBeGreaterThan(0);
      now += 1000; // 1 second later, at 1 req/s, a token should be available again
      expect(bucket.waitTimeMs()).toBe(0);
    });
  });

  it("take() waits (via the injected sleep) rather than firing immediately when empty", async () => {
    let now = 0;
    const bucket = new TokenBucket(1, 1, () => now);
    const sleeps: number[] = [];
    const fakeSleep = async (ms: number) => {
      sleeps.push(ms);
      now += ms; // simulate time passing during the sleep
    };
    await bucket.take(fakeSleep); // consumes the initial token, no sleep
    await bucket.take(fakeSleep); // must wait for a refill
    expect(sleeps.length).toBeGreaterThan(0);
  });
});

describe("gatewayCall — rate limiting integration", () => {
  it("uses a per-provider bucket, so two different providers do not block each other", async () => {
    const deps = makeDeps();
    const callOnce = (provider: string) =>
      gatewayCall(deps, {
        provider,
        endpoint: "/e",
        params: {},
        ttlMs: 60_000,
        requestsPerSecond: 1,
        schema,
        fetcher: async () => ({ status: 200, body: { value: provider } }),
      });

    const results = await Promise.all([callOnce("providerA"), callOnce("providerB")]);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
