import "server-only";

/**
 * Pooled Neon Postgres client (ADR-0001, ADR-0002).
 *
 * `import 'server-only'` above makes this a compile-time invariant: any client
 * component that transitively imports this module fails the Next.js build
 * rather than leaking DATABASE_URL at runtime (spec 0001 § Security item 2).
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  // Fail fast with the variable NAME only, never a value (ADR-0002 §1).
  throw new Error("Missing required environment variable: DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl });

export const db = drizzle(pool, { schema });

export type Database = typeof db;
