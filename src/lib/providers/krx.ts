import "server-only";

/**
 * KRX Open API client — daily close prices for held KRX-listed securities.
 *
 * Endpoints confirmed against the user's own KRX Open API mypage
 * subscriptions (2026-09-09), host `data-dbg.krx.co.kr`, `AUTH_KEY` request
 * header:
 *   - 주식 > 유가증권 일별매매정보:  GET /svc/apis/sto/stk_bydd_trd?basDd=YYYYMMDD
 *   - 증권상품 > ETF 일별매매정보:   GET /svc/apis/etp/etf_bydd_trd?basDd=YYYYMMDD
 * (two separate products — the stock one is scoped to 주권/equity shares and
 * does not cover ETF-listed securities, hence the second endpoint.)
 *
 * NOTE: the portal's own docs page shows these same paths under `/svc/sample/
 * apis/...` — that "sample" tier is a separate public demo product that only
 * accepts KRX's shared public sample key and always returns fixed 2020-04-14
 * data regardless of the requested date. The user's own approved key only
 * works against the non-`/sample/` path below, confirmed via manual curl
 * (2026-09-09) returning live current-date data.
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
 *
 * Confirmed empirically (2026-09-09, evening KST, well after the 15:30 KST
 * close): requesting the CURRENT calendar date returns an empty `OutBlock_1`
 * — this dataset is not published same-day. `fetchLatestKrxDailyTrades`
 * below walks backwards day by day (bounded) until it finds a non-empty
 * result, and reports the row's own `BAS_DD` so the caller stores prices
 * under the date they actually apply to, not the originally-requested date.
 */
import { z } from "zod";
import { sub, toDecimal, toNumericString, type Decimal } from "@/lib/money";
import { gatewayCall, requireEnv, type GatewayDeps, type GatewayResult } from "./gateway";

export const KRX_REQUIRED_ENV = ["KRX_API_KEY"] as const;
const TTL_MS = 20 * 60 * 60 * 1000; // ~20h, see note above
const REQUESTS_PER_SECOND = 1;

// Only the fields this app actually uses. `.passthrough()` because the stock
// and ETF products return different extra fields (e.g. ETF adds NAV,
// IDX_IND_NM) that are irrelevant here and shouldn't fail validation.
const krxDailyRowSchema = z
  .object({
    BAS_DD: z.string(), // YYYYMMDD; the date this row's figures actually apply to
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

function shiftDate(yyyyMmDd: string, days: number): string {
  const parts = yyyyMmDd.split("-").map(Number);
  const [y, m, d] = [parts[0]!, parts[1]!, parts[2]!];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const MAX_LOOKBACK_DAYS = 5; // covers weekends plus a multi-day KR holiday run

/** Walks backwards from `tradeDate` (bounded) until a non-empty OutBlock_1 is
 * found — handles this dataset's publication lag and multi-day non-trading
 * gaps (weekends, holidays) without the caller needing to know the KRX
 * trading calendar. */
async function fetchLatestKrxDailyTrades(
  deps: GatewayDeps,
  endpoint: string,
  tradeDate: string,
  env: NodeJS.ProcessEnv,
): Promise<GatewayResult<KrxDailyResponse>> {
  let date = tradeDate;
  let last: GatewayResult<KrxDailyResponse> = { ok: false, error: "no attempts made", fromCache: false };
  for (let i = 0; i <= MAX_LOOKBACK_DAYS; i++) {
    last = await fetchKrxDailyTrades(deps, endpoint, { tradeDate: date }, env);
    if (last.ok && last.data && last.data.OutBlock_1.length > 0) {
      return last;
    }
    date = shiftDate(date, -1);
  }
  return last;
}

export function fetchKrxStockDailyTrades(
  deps: GatewayDeps,
  params: KrxDailyTradesParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayResult<KrxDailyResponse>> {
  return fetchLatestKrxDailyTrades(deps, "/svc/apis/sto/stk_bydd_trd", params.tradeDate, env);
}

export function fetchKrxEtfDailyTrades(
  deps: GatewayDeps,
  params: KrxDailyTradesParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayResult<KrxDailyResponse>> {
  return fetchLatestKrxDailyTrades(deps, "/svc/apis/etp/etf_bydd_trd", params.tradeDate, env);
}

/**
 * KRX ships every field as a string and uses a blank (and occasionally "-")
 * for "no figure" — a security that didn't trade that session, was halted, or
 * wasn't listed yet. Feeding that straight to `toDecimal` throws
 * `[DecimalError] Invalid argument`, which would abort the whole daily job for
 * one untradeable holding, so parse defensively and report "no data" instead.
 */
function parseKrxNumber(raw: string): Decimal | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (trimmed === "" || !/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return null;
  return toDecimal(trimmed);
}

/** Looks up one security's close/prevClose by KRX 6-digit issue code from a
 * fetchKrxStockDailyTrades/fetchKrxEtfDailyTrades result. Returns null when the
 * code isn't in that result's OutBlock_1 or the row carries no usable close.
 * `tradeDate` is the row's own BAS_DD (YYYY-MM-DD) — the date these figures
 * actually apply to, which may be earlier than what was requested.
 * `prevClose` is null when the day-over-day change field is blank. */
export function findKrxClose(
  data: KrxDailyResponse,
  isuCd: string,
): { close: string; prevClose: string | null; tradeDate: string } | null {
  const row = data.OutBlock_1.find((r) => r.ISU_CD === isuCd);
  if (!row) return null;

  const close = parseKrxNumber(row.TDD_CLSPRC);
  if (close === null) return null;

  const change = parseKrxNumber(row.CMPPREVDD_PRC);
  const prevClose = change === null ? null : sub(close, change);
  const tradeDate = `${row.BAS_DD.slice(0, 4)}-${row.BAS_DD.slice(4, 6)}-${row.BAS_DD.slice(6, 8)}`;
  return {
    close: toNumericString(close),
    prevClose: prevClose === null ? null : toNumericString(prevClose),
    tradeDate,
  };
}
