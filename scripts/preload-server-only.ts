/**
 * `server-only` throws when resolved outside a bundler that aliases it away,
 * which is exactly what happens when a plain `bun` script imports the app's
 * provider modules. This preload makes it a no-op **for scripts only** — the
 * guard itself is untouched, so it still fails a Next client-graph build.
 *
 * Usage: bun --preload ./scripts/preload-server-only.ts scripts/<name>.ts
 */
import { plugin } from "bun";

plugin({
  name: "server-only-noop",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});
