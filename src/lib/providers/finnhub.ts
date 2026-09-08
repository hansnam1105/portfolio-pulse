import "server-only";

/**
 * Finnhub client — US quotes + company news (spec 0001 § Provider integration
 * matrix). Endpoint shapes match Finnhub's publicly documented REST API:
 *   GET /api/v1/quote?symbol=...&token=...            -> { c, d, dp, h, l, o, pc, t }
 *   GET /api/v1/company-news?symbol=...&from=...&to=...&token=...  -> News[]
 * Cadence/TTL: daily after US close, 12h TTL.
 */
import { z } from "zod";
import { gatewayCall, requireEnv, type GatewayDeps, type GatewayResult } from "./gateway";

export const FINNHUB_REQUIRED_ENV = ["FINNHUB_API_KEY"] as const;
const TTL_MS = 12 * 60 * 60 * 1000;
const REQUESTS_PER_SECOND = 1;

const finnhubQuoteSchema = z.object({
  c: z.number(), // current price
  d: z.number().nullable(), // change
  dp: z.number().nullable(), // percent change
  h: z.number(), // high
  l: z.number(), // low
  o: z.number(), // open
  pc: z.number(), // previous close
  t: z.number(), // unix timestamp
});

const finnhubNewsItemSchema = z.object({
  category: z.string().optional(),
  datetime: z.number(), // unix seconds
  headline: z.string(),
  id: z.number(),
  image: z.string().optional(),
  related: z.string().optional(),
  source: z.string(),
  summary: z.string().optional(),
  url: z.string(),
});

const finnhubNewsResponseSchema = z.array(finnhubNewsItemSchema);

export type FinnhubQuote = z.infer<typeof finnhubQuoteSchema>;
export type FinnhubNewsItem = z.infer<typeof finnhubNewsItemSchema>;

export async function fetchFinnhubQuote(
  deps: GatewayDeps,
  symbol: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayResult<FinnhubQuote>> {
  const { FINNHUB_API_KEY } = requireEnv(FINNHUB_REQUIRED_ENV, env);
  const endpoint = "/api/v1/quote";

  return gatewayCall(deps, {
    provider: "finnhub",
    endpoint,
    params: { symbol },
    ttlMs: TTL_MS,
    requestsPerSecond: REQUESTS_PER_SECOND,
    schema: finnhubQuoteSchema,
    fetcher: async () => {
      const url = new URL(`https://finnhub.io${endpoint}`);
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("token", FINNHUB_API_KEY);
      const response = await fetch(url);
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    },
  });
}

export interface FinnhubCompanyNewsParams {
  symbol: string;
  /** YYYY-MM-DD */
  from: string;
  /** YYYY-MM-DD */
  to: string;
}

export async function fetchFinnhubCompanyNews(
  deps: GatewayDeps,
  params: FinnhubCompanyNewsParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayResult<FinnhubNewsItem[]>> {
  const { FINNHUB_API_KEY } = requireEnv(FINNHUB_REQUIRED_ENV, env);
  const endpoint = "/api/v1/company-news";

  return gatewayCall(deps, {
    provider: "finnhub",
    endpoint,
    params: { ...params },
    ttlMs: TTL_MS,
    requestsPerSecond: REQUESTS_PER_SECOND,
    schema: finnhubNewsResponseSchema,
    fetcher: async () => {
      const url = new URL(`https://finnhub.io${endpoint}`);
      url.searchParams.set("symbol", params.symbol);
      url.searchParams.set("from", params.from);
      url.searchParams.set("to", params.to);
      url.searchParams.set("token", FINNHUB_API_KEY);
      const response = await fetch(url);
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    },
  });
}
