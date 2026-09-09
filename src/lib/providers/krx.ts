import "server-only";

/**
 * KRX Open API client — daily close prices for held KRX-listed securities.
 *
 * Endpoints confirmed against the user's own KRX Open API mypage
 * subscriptions (2026-09-09), host `data-dbg.krx.co.kr`, `AUTH_KEY` request
 * header:
 *   - 주식 > 유가증권 일별매매정보:  GET /svc/sample/apis/sto/stk_bydd_trd?basDd=YYYYMMDD
 *   - 증권상품 > ETF 일별매매정보:   GET /svc/sample/apis/etp/etf_bydd_trd?basDd=YYYYMMDD
 * (two separate products — the stock one is scoped to 주권/equity shares and
 * does not cover ETF-listed securities, hence the second endpoint.)
 *
 * Both return their response's `OutBlock_1` array as the ENTIRE day's market
 * for that product, not scoped to any requested ticker — so this is one call
 * per product per calendar day for the whole portfolio, not one call per
 * holding (see fetchKrxStockDailyTrades/fetchKrxEtfDailyTrades below and
 * their caller in build.ts, which looks up each holding's ISU_CD in
 * whichever result actually contains it).
 *
 * Cadence/TTL per spec 0001 § Provider integration matrix: fetch daily after
 * KRX close; cache "until next trading close" — approximated here as 20
 * hours, comfortably shorter than one trading day, so a same-day retry after
 * a transient failure still refetches rather than serving yesterday's cache
 * past the next close.
 */
import { z } from "zod";
import { sub, toDecimal, toNumericString } from "@/lib/money";
import { gatewayCall, requireEnv, type GatewayDeps, type GatewayResult } from "./gateway";

export const KRX_REQUIRED_ENV = ["KRX_API_KEY"] as const;
const TTL_MS = 20 * 60 * 60 * 1000; // ~20h, see note above
const REQUESTS_PER_SECOND = 1;

// Only the fields this app actually uses. `.passthrough()` because the stock
// and ETF products return different extra fields (e.g. ETF adds NAV,
// IDX_IND_NM) that are irrelevant here and shouldn't fail validation.
const krxDailyRowSchema = z
  .object({
    ISU_CD: z.string(),
    ISU_NM: z.string(),
    TDD_CLSPRC: z.string(),
    CMPPREVDD_PRC: z.string(),
  })
  .passthrough();

const krxDailyResponseSchema = z.object({
  OutBlock_1: z.array(krxDailyRowSchema),
});

export type KrxDailyRow = z.infer<typeof krxDailyRowSchema>;
export type KrxDailyResponse = z.infer<typeof krxDailyResponseSchema>;

export interface KrxDailyTradesParams {
  /** Trading date to fetch, Asia/Seoul calendar date (YYYY-MM-DD). */
  tradeDate: string;
}

async function fetchKrxDailyTrades(
  deps: GatewayDeps,
  endpoint: string,
  params: KrxDailyTradesParams,
  env: NodeJS.ProcessEnv,
): Promise<GatewayResult<KrxDailyResponse>> {
  const { KRX_API_KEY } = requireEnv(KRX_REQUIRED_ENV, env);
  const tradeDateCompact = params.tradeDate.replace(/-/g, "");

  return gatewayCall(deps, {
    provider: "krx",
    endpoint,
    params: { endpoint, tradeDate: tradeDateCompact },
    ttlMs: TTL_MS,
    requestsPerSecond: REQUESTS_PER_SECOND,
    schema: krxDailyResponseSchema,
    fetcher: async () => {
      const url = new URL(`https://data-dbg.krx.co.kr${endpoint}`);
      url.searchParams.set("basDd", tradeDateCompact);
      const response = await fetch(url, {
        headers: { AUTH_KEY: KRX_API_KEY },
      });
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    },
  });
}

export function fetchKrxStockDailyTrades(
  deps: GatewayDeps,
  params: KrxDailyTradesParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayResult<KrxDailyResponse>> {
  return fetchKrxDailyTrades(deps, "/svc/sample/apis/sto/stk_bydd_trd", params, env);
}

export function fetchKrxEtfDailyTrades(
  deps: GatewayDeps,
  params: KrxDailyTradesParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayResult<KrxDailyResponse>> {
  return fetchKrxDailyTrades(deps, "/svc/sample/apis/etp/etf_bydd_trd", params, env);
}

/** Looks up one security's close/prevClose by KRX 6-digit issue code from a
 * fetchKrxStockDailyTrades/fetchKrxEtfDailyTrades result. Returns null if
 * not present in that day's OutBlock_1. */
export function findKrxClose(
  data: KrxDailyResponse,
  isuCd: string,
): { close: string; prevClose: string } | null {
  const row = data.OutBlock_1.find((r) => r.ISU_CD === isuCd);
  if (!row) return null;
  const close = toDecimal(row.TDD_CLSPRC);
  const prevClose = sub(close, toDecimal(row.CMPPREVDD_PRC));
  return { close: toNumericString(close), prevClose: toNumericString(prevClose) };
}
