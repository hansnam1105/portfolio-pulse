import type { NextConfig } from "next";

// ADR-0001: Next.js 15 App Router on Vercel Hobby, Neon Postgres via Drizzle.
// ADR-0002: no provider secret may ever reach the client bundle; this config adds
// belt-and-braces response headers on top of the structural `server-only` guards
// in src/db/index.ts and src/lib/providers/gateway.ts.
const nextConfig: NextConfig = {
  // The Neon serverless driver (@neondatabase/serverless) uses Node APIs that
  // should not be bundled for the Edge/client graph.
  serverExternalPackages: ["@neondatabase/serverless"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
