/**
 * Global test preload (wired via bunfig.toml `[test].preload`).
 *
 * `server-only` (imported by src/lib/providers/gateway.ts, gemini.ts, dart.ts,
 * ecos.ts, finnhub.ts, fmp.ts, krx.ts, naver.ts, and src/lib/briefing/build.ts,
 * per ADR-0002) is a marker package that unconditionally throws unless
 * resolved under Next.js's webpack "react-server" build condition. `bun test`
 * does not set that condition, so every test file that imports (even
 * transitively) one of those server-only modules needs this stubbed out
 * first — hence a preload, not a per-file mock.
 */
import { mock } from "bun:test";

mock.module("server-only", () => ({}));
