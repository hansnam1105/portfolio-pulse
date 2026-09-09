import "server-only";

/**
 * Naver Search API client — Korean-language news per held security name
 * (spec 0001 § Provider integration matrix).
 *
 * MIGRATED (2026-09-10) to NAVER API HUB — the legacy NAVER Developers
 * Center endpoint (`openapi.naver.com/v1/search/news.json` with
 * `X-Naver-Client-Id`/`X-Naver-Client-Secret`) now rejects API HUB
 * credentials with errorCode 024. Per
 * https://guide.ncloud-docs.com/docs/apihub-migration the host, path AND
 * header names all changed; the response body shape is unchanged.
 * Auth still travels in headers (not query params), so there is no
 * key-stripping concern for this provider's endpoint logging.
 * Cadence/TTL: daily job, 12h TTL.
 */
import { z } from "zod";
import { gatewayCall, requireEnv, type GatewayDeps, type GatewayResult } from "./gateway";

export const NAVER_REQUIRED_ENV = ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"] as const;
const TTL_MS = 12 * 60 * 60 * 1000;
const REQUESTS_PER_SECOND = 1;

const naverNewsItemSchema = z.object({
  title: z.string(), // may contain <b> highlight tags per Naver's API behavior
  originallink: z.string(),
  link: z.string(),
  description: z.string(),
  pubDate: z.string(), // RFC 822 format
});

const naverNewsResponseSchema = z.object({
  lastBuildDate: z.string().optional(),
  total: z.number().optional(),
  start: z.number().optional(),
  display: z.number().optional(),
  items: z.array(naverNewsItemSchema).optional().default([]),
});

export type NaverNewsItem = z.infer<typeof naverNewsItemSchema>;
export type NaverNewsResponse = z.infer<typeof naverNewsResponseSchema>;

export interface NaverNewsSearchParams {
  query: string;
  display?: number; // max 100 per Naver's documented limit
  sort?: "sim" | "date";
}

export async function fetchNaverNews(
  deps: GatewayDeps,
  params: NaverNewsSearchParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayResult<NaverNewsResponse>> {
  const { NAVER_CLIENT_ID, NAVER_CLIENT_SECRET } = requireEnv(NAVER_REQUIRED_ENV, env);
  const endpoint = "/search/v1/news";

  return gatewayCall(deps, {
    provider: "naver",
    endpoint,
    params: { query: params.query, display: params.display ?? 20, sort: params.sort ?? "date" },
    ttlMs: TTL_MS,
    requestsPerSecond: REQUESTS_PER_SECOND,
    schema: naverNewsResponseSchema,
    fetcher: async () => {
      const url = new URL(`https://naverapihub.apigw.ntruss.com${endpoint}`);
      url.searchParams.set("query", params.query);
      url.searchParams.set("display", String(params.display ?? 20));
      url.searchParams.set("sort", params.sort ?? "date");
      const response = await fetch(url, {
        headers: {
          "X-NCP-APIGW-API-KEY-ID": NAVER_CLIENT_ID,
          "X-NCP-APIGW-API-KEY": NAVER_CLIENT_SECRET,
        },
      });
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    },
  });
}
