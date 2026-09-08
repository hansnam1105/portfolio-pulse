import "server-only";

/**
 * Bank of Korea ECOS client — base rate, CPI, USD/KRW (spec 0001 § Provider
 * integration matrix). Endpoint shape matches ECOS's publicly documented
 * `StatisticSearch` REST API:
 *   /StatisticSearch/{apiKey}/json/kr/{start}/{end}/{statCode}/{cycle}/{startDate}/{endDate}/{itemCode1}
 * returning `{ StatisticSearch: { list_total_count, row: [...] } }`.
 * Cadence/TTL: daily job, 24h TTL.
 */
import { z } from "zod";
import { gatewayCall, requireEnv, type GatewayDeps, type GatewayResult } from "./gateway";

export const ECOS_REQUIRED_ENV = ["ECOS_API_KEY"] as const;
const TTL_MS = 24 * 60 * 60 * 1000;
const REQUESTS_PER_SECOND = 1;

const ecosRowSchema = z.object({
  STAT_CODE: z.string(),
  STAT_NAME: z.string(),
  ITEM_CODE1: z.string(),
  ITEM_NAME1: z.string(),
  UNIT_NAME: z.string(),
  TIME: z.string(), // YYYYMMDD or YYYYMM depending on cycle
  DATA_VALUE: z.string(), // ECOS returns numeric values as strings
});

const ecosResponseSchema = z.object({
  StatisticSearch: z.object({
    list_total_count: z.number().optional(),
    row: z.array(ecosRowSchema).default([]),
  }),
});

export type EcosRow = z.infer<typeof ecosRowSchema>;
export type EcosResponse = z.infer<typeof ecosResponseSchema>;

export interface EcosStatisticSearchParams {
  /** ECOS statistic table code, e.g. '722Y001' (base rate), '901Y009' (CPI). */
  statCode: string;
  /** 'D' | 'M' | 'Q' | 'A' cycle. */
  cycle: "D" | "M" | "Q" | "A";
  /** Format matches `cycle` (YYYYMMDD for D, YYYYMM for M, etc). */
  startDate: string;
  endDate: string;
  /** Item code within the statistic table (e.g. currency pair code for FX). */
  itemCode1: string;
}

export async function fetchEcosStatistic(
  deps: GatewayDeps,
  params: EcosStatisticSearchParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayResult<EcosResponse>> {
  const { ECOS_API_KEY } = requireEnv(ECOS_REQUIRED_ENV, env);
  const endpoint = "/api/StatisticSearch";

  return gatewayCall(deps, {
    provider: "ecos",
    endpoint,
    params: { ...params },
    ttlMs: TTL_MS,
    requestsPerSecond: REQUESTS_PER_SECOND,
    schema: ecosResponseSchema,
    fetcher: async () => {
      const path = [
        endpoint,
        ECOS_API_KEY,
        "json",
        "kr",
        "1",
        "10000",
        params.statCode,
        params.cycle,
        params.startDate,
        params.endDate,
        params.itemCode1,
      ].join("/");
      const url = `https://ecos.bok.or.kr${path}`;
      const response = await fetch(url);
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    },
  });
}
