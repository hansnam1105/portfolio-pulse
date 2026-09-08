import "server-only";

/**
 * The single choke point for every outbound call to an external provider
 * (ADR-0002). No component, page, or provider client may call `fetch` against
 * a provider directly — everything routes through `gatewayCall` here.
 *
 * Responsibilities, in order, per call (ADR-0002 § Decision):
 *   1. Secret injection — `requireEnv` reads process.env by variable NAME only;
 *      a missing key fails fast with the name, never a value, in the error.
 *   2. `import 'server-only'` above — a client component importing this file
 *      fails the build.
 *   3. Cache-first lookup against `provider_cache` (via the injected
 *      `CacheStore`), keyed by a normalized request signature, TTL per call.
 *   4. Rate limiting — a conservative per-provider token bucket, default
 *      1 request/second (spec 0001 § Provider integration matrix).
 *   5. Zod validation — every response is narrowed before it can reach the
 *      domain layer.
 *   6. Call logging into `provider_call_log` with query strings stripped.
 *   7. Normalized failure — providers get a typed `{ ok, data | error }`
 *      result, never a thrown vendor error, so one failing provider degrades
 *      the briefing instead of aborting the job.
 *
 * `CacheStore`/`CallLogger` are injected rather than imported as a module-level
 * singleton so this file (and its rate-limiter/cache-key logic) can be unit
 * tested with in-memory fakes and zero network calls or live DATABASE_URL —
 * see tests/lib/providers/gateway.test.ts. `createDrizzleCacheStore` /
 * `createDrizzleCallLogger` below wire the real Postgres-backed
 * implementations lazily (dynamic import), so importing this module alone
 * never requires DATABASE_URL to be set.
 */
import crypto from "node:crypto";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Secret injection
// ---------------------------------------------------------------------------

/**
 * Reads the named environment variables and returns them. Throws with the
 * variable NAME only (never a value) if any is missing — provider clients
 * declare which vars they need and call this instead of reading
 * `process.env` themselves.
 */
export function requireEnv<const N extends readonly string[]>(
  names: N,
  env: NodeJS.ProcessEnv = process.env,
): { [K in N[number]]: string } {
  const result: Record<string, string> = {};
  for (const name of names) {
    const value = env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    result[name] = value;
  }
  return result as { [K in N[number]]: string };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export interface CacheEntry {
  payload: unknown;
  fetchedAt: Date;
  expiresAt: Date;
}

export interface CacheStore {
  get(cacheKey: string): Promise<CacheEntry | null>;
  set(
    cacheKey: string,
    provider: string,
    payload: unknown,
    fetchedAt: Date,
    expiresAt: Date,
  ): Promise<void>;
}

/** In-memory CacheStore for tests. Never used in production wiring. */
export function createInMemoryCacheStore(): CacheStore {
  const store = new Map<string, CacheEntry>();
  return {
    async get(cacheKey) {
      return store.get(cacheKey) ?? null;
    },
    async set(cacheKey, _provider, payload, fetchedAt, expiresAt) {
      store.set(cacheKey, { payload, fetchedAt, expiresAt });
    },
  };
}

/** Postgres-backed CacheStore (`provider_cache` table). Lazily imports the db
 * client so a module that only needs cacheKeyFor/gatewayCall's pure logic
 * never requires DATABASE_URL. */
export function createDrizzleCacheStore(): CacheStore {
  return {
    async get(cacheKey) {
      const { db } = await import("@/db");
      const { providerCache } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(providerCache)
        .where(eq(providerCache.cacheKey, cacheKey))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return { payload: row.payload, fetchedAt: row.fetchedAt, expiresAt: row.expiresAt };
    },
    async set(cacheKey, provider, payload, fetchedAt, expiresAt) {
      const { db } = await import("@/db");
      const { providerCache } = await import("@/db/schema");
      await db
        .insert(providerCache)
        .values({ cacheKey, provider, payload, fetchedAt, expiresAt })
        .onConflictDoUpdate({
          target: providerCache.cacheKey,
          set: { provider, payload, fetchedAt, expiresAt },
        });
    },
  };
}

/** Normalizes a request signature into a stable cache key. */
export function cacheKeyFor(
  provider: string,
  endpoint: string,
  params: Record<string, unknown>,
): string {
  const sortedKeys = Object.keys(params).sort();
  const normalized = JSON.stringify(params, sortedKeys);
  return crypto.createHash("sha256").update(`${provider}:${endpoint}:${normalized}`).digest("hex");
}

// ---------------------------------------------------------------------------
// Call logging (query strings stripped — ADR-0002 §6 / spec § Security 8)
// ---------------------------------------------------------------------------

export interface CallLogEntry {
  provider: string;
  endpoint: string;
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
}

export interface CallLogger {
  log(entry: CallLogEntry): Promise<void>;
}

export function createInMemoryCallLogger(): CallLogger & { entries: CallLogEntry[] } {
  const entries: CallLogEntry[] = [];
  return {
    entries,
    async log(entry) {
      entries.push(entry);
    },
  };
}

export function createDrizzleCallLogger(): CallLogger {
  return {
    async log(entry) {
      const { db } = await import("@/db");
      const { providerCallLog } = await import("@/db/schema");
      await db.insert(providerCallLog).values({
        provider: entry.provider,
        endpoint: entry.endpoint,
        ok: entry.ok,
        status: entry.status,
        latencyMs: entry.latencyMs,
        error: entry.error,
      });
    },
  };
}

/** Strips the query string (and any fragment) from a URL or path, so a
 * provider key carried as a query parameter (KRX/DART/ECOS style) is never
 * persisted into `provider_call_log`. */
export function stripQueryString(urlOrPath: string): string {
  const withoutFragment = urlOrPath.split("#")[0] ?? urlOrPath;
  const withoutQuery = withoutFragment.split("?")[0] ?? withoutFragment;
  return withoutQuery;
}

// ---------------------------------------------------------------------------
// Rate limiter — conservative per-provider token bucket, default 1 req/s
// ---------------------------------------------------------------------------

export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number = Math.max(1, ratePerSecond),
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = this.burst;
    this.lastRefillMs = this.now();
  }

  private refill(): void {
    const nowMs = this.now();
    const elapsedSeconds = Math.max(0, (nowMs - this.lastRefillMs) / 1000);
    this.tokens = Math.min(this.burst, this.tokens + elapsedSeconds * this.ratePerSecond);
    this.lastRefillMs = nowMs;
  }

  /** Milliseconds to wait before a token would be available, or 0 if one is available now. */
  waitTimeMs(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return ((1 - this.tokens) / this.ratePerSecond) * 1000;
  }

  async take(sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
    for (;;) {
      const wait = this.waitTimeMs();
      if (wait <= 0) {
        this.tokens -= 1;
        return;
      }
      await sleep(Math.ceil(wait));
    }
  }
}

const bucketsByProvider = new Map<string, TokenBucket>();

function getBucket(provider: string, ratePerSecond: number): TokenBucket {
  let bucket = bucketsByProvider.get(provider);
  if (!bucket) {
    bucket = new TokenBucket(ratePerSecond);
    bucketsByProvider.set(provider, bucket);
  }
  return bucket;
}

/** Test-only: reset the module-level rate-limiter state between test cases. */
export function _resetRateLimiterStateForTests(): void {
  bucketsByProvider.clear();
}

// ---------------------------------------------------------------------------
// gatewayCall
// ---------------------------------------------------------------------------

export interface GatewayDeps {
  cacheStore: CacheStore;
  callLogger: CallLogger;
}

export interface GatewayCallOptions<Schema extends z.ZodTypeAny> {
  provider: string;
  /** Path only (no query string) — used for cache-miss logging. */
  endpoint: string;
  /** Request parameters, used to build a stable, normalized cache key. */
  params: Record<string, unknown>;
  ttlMs: number;
  /** Defaults to 1 request/second per ADR-0002's stated conservatism. */
  requestsPerSecond?: number;
  schema: Schema;
  /** Performs the actual network call. Must not throw for an HTTP error
   * status — return it in `status`/`body` so it can be logged and normalized. */
  fetcher: () => Promise<{ status: number; body: unknown }>;
}

export interface GatewayResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  fromCache: boolean;
}

// Inferring the result type as `z.infer<Schema>` (rather than a bare `T` bound
// via `schema: z.ZodType<T>`) matters: TS's generic inference through a plain
// `z.ZodType<T>` parameter position does not apply the same optional-key
// simplification that `z.infer<typeof schema>` does for object schemas with
// `.default(...)` fields, so the two would otherwise disagree on which
// properties are optional. Keying inference off `Schema` itself keeps this
// signature's output type identical to what callers get from `z.infer`.
export async function gatewayCall<Schema extends z.ZodTypeAny>(
  deps: GatewayDeps,
  options: GatewayCallOptions<Schema>,
): Promise<GatewayResult<z.infer<Schema>>> {
  type T = z.infer<Schema>;
  const cacheKey = cacheKeyFor(options.provider, options.endpoint, options.params);
  const now = new Date();

  const cached = await deps.cacheStore.get(cacheKey);
  if (cached && cached.expiresAt.getTime() > now.getTime()) {
    const parsed = options.schema.safeParse(cached.payload);
    if (parsed.success) {
      return { ok: true, data: parsed.data, fromCache: true };
    }
    // Cached payload no longer matches the schema (e.g. profile changed) — refetch.
  }

  const bucket = getBucket(options.provider, options.requestsPerSecond ?? 1);
  await bucket.take();

  const startedAt = Date.now();
  let status: number | undefined;
  let ok = false;
  let errorMessage: string | undefined;
  let result: GatewayResult<T>;

  try {
    const response = await options.fetcher();
    status = response.status;
    if (response.status < 200 || response.status >= 300) {
      errorMessage = `Provider returned HTTP ${response.status}`;
      result = { ok: false, error: errorMessage, fromCache: false };
    } else {
      const parsed = options.schema.safeParse(response.body);
      if (!parsed.success) {
        errorMessage = `Zod validation failed: ${parsed.error.message}`;
        result = { ok: false, error: errorMessage, fromCache: false };
      } else {
        ok = true;
        await deps.cacheStore.set(
          cacheKey,
          options.provider,
          parsed.data,
          now,
          new Date(now.getTime() + options.ttlMs),
        );
        result = { ok: true, data: parsed.data, fromCache: false };
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    result = { ok: false, error: errorMessage, fromCache: false };
  }

  const latencyMs = Date.now() - startedAt;
  // Call logging must never abort the caller's flow (ADR-0002 §7 normalized failure).
  await deps.callLogger
    .log({
      provider: options.provider,
      endpoint: stripQueryString(options.endpoint),
      ok,
      status,
      latencyMs,
      error: errorMessage,
    })
    .catch(() => undefined);

  return result;
}

/** Production wiring: Postgres-backed cache + call log. */
export function createDefaultGatewayDeps(): GatewayDeps {
  return {
    cacheStore: createDrizzleCacheStore(),
    callLogger: createDrizzleCallLogger(),
  };
}
