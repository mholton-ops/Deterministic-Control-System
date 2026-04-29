import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type DcsSchema = typeof schema;

export function createPool(connectionString?: string): Pool {
  const resolved = connectionString ?? process.env.DATABASE_URL ?? "postgres://dcs:dcs@localhost:5432/dcs";

  return new Pool({ connectionString: resolved });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type DcsDb = ReturnType<typeof createDb>;
