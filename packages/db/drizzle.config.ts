import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://dcs:dcs@localhost:5432/dcs",
  },
  verbose: true,
  strict: true,
} satisfies Config;
