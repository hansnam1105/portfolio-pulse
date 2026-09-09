import "server-only";

/**
 * FMP (Financial Modeling Prep) client — US company fundamentals, slow-moving
 * (spec 0001 § Provider integration matrix). FMP retired its `/api/v3/`
 * endpoints for non-legacy keys on 2025-08-31 (confirmed via live 403,
 * 2026-09-10: "Legacy Endpoint ... only available for legacy users"); this
 * now targets the current `/stable/profile?symbol=...&apikey=...` endpoint
 * (query-param based, not path-based), confirmed working live.
 * Cadence/TTL: weekly, on demand for new tickers; 7d TTL.
 */
import { z } from "zod";
import { gatewayCall, requireEnv, type GatewayDeps, type GatewayResult } from "./gateway";

export const FMP_REQUIRED_ENV = ["FMP_API_KEY"] as const;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUESTS_PER_SECOND = 1;

const fmpProfileSchema = z.object({
  symbol: z.string(),
  companyName: z.string(),
  sector: z.string().optional(),
  industry: z.string().optional(),
  currency: z.string().optional(),
  exchange: z.string().optional(),
  marketCap: z.number().optional(),
  description: z.string().optional(),
});

const fmpProfileResponseSchema = z.array(fmpProfileSchema);

export type FmpProfile = z.infer<typeof fmpProfileSchema>;

export async function fetchFmpProfile(
  deps: GatewayDeps,
  symbol: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayResult<FmpProfile[]>> {
  const { FMP_API_KEY } = requireEnv(FMP_REQUIRED_ENV, env);
  const endpoint = "/stable/profile";

  return gatewayCall(deps, {
    provider: "fmp",
    endpoint,
    params: { symbol },
    ttlMs: TTL_MS,
    requestsPerSecond: REQUESTS_PER_SECOND,
    schema: fmpProfileResponseSchema,
    fetcher: async () => {
      const url = new URL(`https://financialmodelingprep.com${endpoint}`);
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("apikey", FMP_API_KEY);
      const response = await fetch(url);
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    },
  });
}
