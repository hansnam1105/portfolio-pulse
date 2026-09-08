import { defineConfig } from "drizzle-kit";

// ADR-0001: Drizzle Kit generates SQL migrations from src/db/schema.ts.
// DATABASE_URL is read from the environment only — never hardcoded, never logged.
// `bun run db:generate` is safe to run without a live database (SQL-only diff).
// `bun run db:migrate` requires a real DATABASE_URL and must not be run against a
// live database by an agent (see spec 0001 § Files to change, src/db/migrations/).
const databaseUrl = process.env.DATABASE_URL ?? "postgres://placeholder/placeholder";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
