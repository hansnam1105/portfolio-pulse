import { auth } from "@/auth";
import { NextResponse } from "next/server";

/**
 * Per-request CSP nonce (ADR-0002's strict `script-src 'self'` header, moved
 * here from next.config.ts, cannot coexist with Next.js App Router's inline
 * hydration/RSC-streaming scripts without one — Next automatically applies
 * this nonce to the inline scripts it injects once it appears in the
 * response's own CSP header). `strict-dynamic` lets those nonce'd scripts
 * load their own child chunks; `'self'` is kept only as a fallback for
 * browsers that don't support `strict-dynamic`.
 */
function cspHeader(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Gate every page/API route behind a signed-in session, except:
 * - /api/auth/*  — Auth.js's own sign-in/callback/sign-out routes
 * - /api/jobs/*  — already guarded by its own CRON_SECRET bearer check
 *   (src/app/api/jobs/daily-briefing/route.ts); requiring a session here
 *   would break the cron caller, which has no browser session
 * - /api/health  — deliberately secret-free status endpoint
 *
 * /login (the sign-in page, ADR-0005) still goes through this middleware —
 * it needs the same nonce'd CSP header to hydrate — but is exempted from the
 * redirect-when-unauthenticated check below, or it would redirect-loop on
 * itself.
 */
export default auth((req) => {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = cspHeader(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  if (!req.auth && req.nextUrl.pathname !== "/login") {
    const response = NextResponse.redirect(new URL("/login", req.nextUrl));
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
});

export const config = {
  matcher: ["/((?!api/auth|api/jobs|api/health|_next/static|_next/image|favicon.ico).*)"],
};
