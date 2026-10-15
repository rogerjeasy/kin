import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { testDatabases } from "./testing/databases.ts";

const { admin } = testDatabases();

describe("the migrated database", () => {
  it("has its tables", async () => {
    const rows = await admin.execute<{ count: string }>(sql`select count(*) from pg_tables where schemaname = 'public'`);
    expect(Number(rows.rows[0]?.count)).toBeGreaterThan(20);
  });
});
