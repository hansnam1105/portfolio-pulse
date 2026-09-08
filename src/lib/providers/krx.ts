import "server-only";

/**
 * KRX Open API client — daily close prices for held KRX-listed securities.
 *
 * Cadence/TTL per spec 0001 § Provider integration matrix: fetch daily after
 * KRX close; cache "until next trading close" — approximated here as 20 hours,
 * comfortably shorter than one trading day, so a same-day retry after a
 * transient failure still refetches rather than serving yesterday's cache
 * past the next close. // TODO(verify): replace with an exact
 * "next KRX trading-day close" TTL once the job's own trading-calendar helper
 * exists; a fixed duration is a conservative approximation, not the real rule.
 *
 * // TODO(verify): the Korea Exchange issues several distinct "Open API"
 * products (data.krx.co.kr's 정보데이터시스템 download API vs. other KRX data
 * feeds); this client targets the general shape of a daily-OHLC-by-ticker
 * endpoint keyed by an auth key, which is the assumption spec 0001 records
 * under Q7 (delegated to architect judgment, NOT independently verified
 * against the user's actual key/scope). Confirm the exact endpoint path,
 * auth placement (header vs. query param), and response field names against
 * the user's issued key and the current KRX Open API documentation before
 * relying on this in production. Because all KRX price access is routed
 * through this one file behind the gateway, correcting a wrong endpoint here
 * has no schema or caller impact (spec 0001 § Provider integration matrix).
 */
import { z } from "zod";
import { gatewayCall, requireEnv, type GatewayDeps, type GatewayResult } from "./gateway";

export const KRX_REQUIRED_ENV = ["KRX_API_KEY"] as const;
const TTL_MS = 20 * 60 * 60 * 1000; // ~20h, see note above
const REQUESTS_PER_SECOND = 1;

// TODO(verify): field names are a best-effort guess at a typical KRX daily
// close payload shape, not confirmed against live KRX Open API docs.
const krxDailyCloseSchema = z.object({
  isuCd: z.string(), // TODO(verify): KRX issue code / short code field name
  trdDd: z.string(), // trade date, expected YYYYMMDD
  tddClsprc: z.union([z.string(), z.number()]), // close price
  vs: z.union([z.string(), z.number()]).optional(), // change vs. prev close
});

export type KrxDailyClose = z.infer<typeof krxDailyCloseSchema>;

export interface KrxClosePriceParams {
  /** KRX 6-digit issue code, e.g. '005930'. */
  symbol: string;
  /** Trading date to fetch, Asia/Seoul calendar date (YYYY-MM-DD). */
  tradeDate: string;
}

export async function fetchKrxDailyClose(
  deps: GatewayDeps,
  params: KrxClosePriceParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayResult<KrxDailyClose>> {
  const { KRX_API_KEY } = requireEnv(KRX_REQUIRED_ENV, env);
  const endpoint = "/svc/apis/sto/stk_isu_base_info"; // TODO(verify): actual KRX endpoint path
  const tradeDateCompact = params.tradeDate.replace(/-/g, "");

  return gatewayCall(deps, {
    provider: "krx",
    endpoint,
    params: { symbol: params.symbol, tradeDate: tradeDateCompact },
    ttlMs: TTL_MS,
    requestsPerSecond: REQUESTS_PER_SECOND,
    schema: krxDailyCloseSchema,
    fetcher: async () => {
      const url = new URL(`https://data-dbg.krx.co.kr${endpoint}`); // TODO(verify): correct KRX host
      url.searchParams.set("isuCd", params.symbol);
      url.searchParams.set("basDd", tradeDateCompact);
      const response = await fetch(url, {
        headers: { AUTH_KEY: KRX_API_KEY }, // TODO(verify): correct auth header name
      });
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    },
  });
}
