import "server-only";

/**
 * Yahoo Finance chart endpoint — historical daily closes for US securities.
 *
 * ## Why this exists, and why it is quarantined (ADR-0007)
 *
 * Nothing else free covers US **ETF** history: Finnhub's `/stock/candle` is
 * 403 on the free tier, FMP's `/stable/historical-price-eod` returns 402 for
 * ETF symbols on the free plan, and Stooq sits behind a JS proof-of-work
 * check. This endpoint is undocumented and carries no API contract — it can
 * change or start refusing traffic without notice.
 *
 * It is therefore used **only by scripts/backfill-prices.ts**, never by the
 * daily job or any request path. The daily job gets US prices (ETFs included)
 * from Finnhub `quote`, which works fine — it is only news and candles that
 * exclude ETFs. So if this breaks, the app keeps working and the only lost
 * capability is re-running a historical backfill.
 *
 * Requests still go through `gatewayCall` so this inherits the same caching,
 * 1 req/s limiter and `provider_call_log` accounting as every other provider.
 */
import { z } from "zod";
import { gatewayCall, type GatewayDeps, type GatewayResult } from "./gateway";

const TTL_MS = 12 * 60 * 60 * 1000;
const REQUESTS_PER_SECOND = 1;

const yahooChartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({ currency: z.string().optional(), symbol: z.string() }).passthrough(),
          timestamp: z.array(z.number()).optional().default([]),
          indicators: z.object({
            quote: z
              .array(z.object({ close: z.array(z.number().nullable()).optional().default([]) }).passthrough())
              .default([]),
          }),
        }).passthrough(),
      )
      .nullable()
      .optional(),
    error: z.unknown().optional(),
  }),
});

export interface YahooDailyClose {
  tradeDate: string; // YYYY-MM-DD
  close: number;
}

export interface YahooChartParams {
  symbol: string;
  /** Yahoo range token, e.g. `1mo`, `3mo`, `6mo`, `1y`. */
  range: string;
}

export async function fetchYahooDailyCloses(
  deps: GatewayDeps,
  params: YahooChartParams,
): Promise<GatewayResult<YahooDailyClose[]>> {
  const endpoint = `/v8/finance/chart/${params.symbol}`;

  const result = await gatewayCall(deps, {
    provider: "yahoo",
    endpoint,
    params: { symbol: params.symbol, range: params.range },
    ttlMs: TTL_MS,
    requestsPerSecond: REQUESTS_PER_SECOND,
    schema: yahooChartSchema,
    fetcher: async () => {
      const url = new URL(`https://query1.finance.yahoo.com${endpoint}`);
      url.searchParams.set("range", params.range);
      url.searchParams.set("interval", "1d");
      // Yahoo refuses requests without a browser-shaped UA.
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    },
  });

  if (!result.ok || !result.data) return { ok: false, error: result.error, fromCache: result.fromCache };

  const series = result.data.chart.result?.[0];
  if (!series) return { ok: false, error: "Yahoo returned no chart series", fromCache: result.fromCache };

  const closes = series.indicators.quote[0]?.close ?? [];
  const points: YahooDailyClose[] = [];
  for (const [i, ts] of series.timestamp.entries()) {
    const close = closes[i];
    // Nulls appear for halted/holiday sessions — skip rather than interpolate.
    if (close === null || close === undefined) continue;
    // Timestamps are the session's OPEN instant. Deriving the trade date in UTC
    // is correct for US sessions (09:30 ET is the same UTC calendar day) and,
    // unlike local-time conversion, does not shift dates when this runs on a
    // KST machine.
    points.push({ tradeDate: new Date(ts * 1000).toISOString().slice(0, 10), close });
  }

  return { ok: true, data: points, fromCache: result.fromCache };
}
