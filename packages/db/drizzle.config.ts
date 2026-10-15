import { defineConfig } from "drizzle-kit";

// Generating a migration reads only the schema. Applying one is `pnpm run migrate`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
});
