import { describe, it, expect, afterEach } from "bun:test";
import { POST } from "@/app/api/jobs/daily-briefing/route";

/**
 * Route-level test for POST /api/jobs/daily-briefing (spec 0001 v3 §
 * Authentication). The route's only job-specific logic is the
 * `Authorization: Bearer $CRON_SECRET` guard — everything past it delegates
 * to `runDailyBriefingJob`/`createDefaultJobDependencies`, whose real
 * orchestration (idempotency, degraded-source handling, status mapping) is
 * covered end-to-end with fixtures/mocks in tests/lib/briefing/build.test.ts.
 *
 * Deliberately does NOT mock "@/lib/briefing/build" here: `bun:test`'s
 * `mock.module` replaces a module in the process-global registry for the
 * remainder of the whole `bun test` run (not just this file), which would
 * corrupt build.test.ts's import of the *real* implementation. Since every
 * case below is rejected by the auth guard before the route ever calls
 * `createDefaultJobDependencies()`, no database or provider/Gemini network
 * call happens regardless — nothing needs mocking.
 */

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("https://example.test/api/jobs/daily-briefing", { method: "POST", headers });
}

describe("POST /api/jobs/daily-briefing — auth guard", () => {
  it("fails closed with 500 when CRON_SECRET is not configured, even with a bearer token supplied", async () => {
    delete process.env.CRON_SECRET;
    const response = await POST(makeRequest("Bearer anything"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/CRON_SECRET/);
  });

  it("returns 401 when no Authorization header is present", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
  });

  it("returns 401 when the bearer token does not match", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const response = await POST(makeRequest("Bearer wrong-token"));
    expect(response.status).toBe(401);
  });

  it("returns 401 for a non-bearer Authorization header", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const response = await POST(makeRequest("Basic dXNlcjpwYXNz"));
    expect(response.status).toBe(401);
  });

  it("returns 401 (not 500) when CRON_SECRET is configured but empty-string bearer token is sent", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const response = await POST(makeRequest("Bearer "));
    expect(response.status).toBe(401);
  });
});
