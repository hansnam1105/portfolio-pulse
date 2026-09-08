import "server-only";

/**
 * DART OpenAPI client — Korean corporate disclosures for held KRX securities.
 *
 * Endpoint shape (opendart.fss.or.kr `/api/list.json`) matches DART's
 * publicly documented disclosure-search API: `crtfc_key` (auth), `corp_code`,
 * `bgn_de`/`end_de` (YYYYMMDD), returning `{ status, message, list: [...] }`.
 * Cadence/TTL per spec 0001 § Provider integration matrix: daily job, 12h TTL.
 */
import { z } from "zod";
import { gatewayCall, requireEnv, type GatewayDeps, type GatewayResult } from "./gateway";

export const DART_REQUIRED_ENV = ["DART_API_KEY"] as const;
const TTL_MS = 12 * 60 * 60 * 1000;
const REQUESTS_PER_SECOND = 1;

const dartDisclosureSchema = z.object({
  corp_code: z.string(),
  corp_name: z.string(),
  stock_code: z.string().optional(),
  corp_cls: z.string().optional(), // Y/K/N/E market classification
  report_nm: z.string(),
  rcept_no: z.string(),
  flr_nm: z.string().optional(),
  rcept_dt: z.string(), // YYYYMMDD
  rm: z.string().optional(),
});

const dartListResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  list: z.array(dartDisclosureSchema).default([]),
});

export type DartDisclosure = z.infer<typeof dartDisclosureSchema>;
export type DartListResponse = z.infer<typeof dartListResponseSchema>;

export interface DartDisclosureListParams {
  /** DART corp_code (from security.corp_code). */
  corpCode: string;
  /** Asia/Seoul calendar dates, YYYY-MM-DD. */
  beginDate: string;
  endDate: string;
}

export async function fetchDartDisclosures(
  deps: GatewayDeps,
  params: DartDisclosureListParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayResult<DartListResponse>> {
  const { DART_API_KEY } = requireEnv(DART_REQUIRED_ENV, env);
  const endpoint = "/api/list.json";
  const beginDe = params.beginDate.replace(/-/g, "");
  const endDe = params.endDate.replace(/-/g, "");

  return gatewayCall(deps, {
    provider: "dart",
    endpoint,
    params: { corpCode: params.corpCode, beginDe, endDe },
    ttlMs: TTL_MS,
    requestsPerSecond: REQUESTS_PER_SECOND,
    schema: dartListResponseSchema,
    fetcher: async () => {
      const url = new URL(`https://opendart.fss.or.kr${endpoint}`);
      url.searchParams.set("crtfc_key", DART_API_KEY);
      url.searchParams.set("corp_code", params.corpCode);
      url.searchParams.set("bgn_de", beginDe);
      url.searchParams.set("end_de", endDe);
      const response = await fetch(url);
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    },
  });
}
