import { describe, expect, it } from "vitest";

import { connect } from "./connection.ts";

const config = {
  host: "localhost",
  port: 5432,
  database: "kin",
  tls: false,
  credentials: { app: { user: "kin_app", password: "x" } },
} as const;

describe("a connection pool", () => {
  it("waits 30 seconds for a connection by default", async () => {
    const db = connect(config, "app");
    expect(db.$client.options.connectionTimeoutMillis).toBe(30_000);
    await db.$client.end();
  });

  it("waits longer when asked, for a web server whose database may be resuming", async () => {
    const db = connect(config, "app", { connectTimeoutMs: 90_000 });
    expect(db.$client.options.connectionTimeoutMillis).toBe(90_000);
    await db.$client.end();
  });
});
