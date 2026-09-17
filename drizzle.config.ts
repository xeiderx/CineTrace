import { defineConfig } from "drizzle-kit";

const dbPath = process.env.DATABASE_PATH?.trim() || "./data/cinetrace.db";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: dbPath },
  strict: true,
  verbose: true,
});
