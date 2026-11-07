import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { connect } from "./connection.ts";
import { MIGRATIONS_FOLDER, migrateDatabase } from "./migrate.ts";
import { startPostgres } from "./testing/postgres-container.ts";

/** The last migration a deployment had already run when this test was written. Later ones are what the next deploy applies. */
const DEPLOYED_THROUGH = 19;

describe("upgrading a database that is already deployed", () => {
  it("applies every migration after the deployed one together, as a deploy does", async () => {
    // A deploy migrates in one transaction on a database whose types already exist. From an empty database
    // PostgreSQL lets a new enum value be used at once, so only this test sees a migration that cannot.
    const folder = mkdtempSync(join(tmpdir(), "kin-deployed-"));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number }[] };
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx <= DEPLOYED_THROUGH) }));

    const container = await startPostgres();
    try {
      const { credentials } = container.config;
      const passwords = { app: credentials.app.password, service: credentials.service.password, provisioner: credentials.provisioner.password };
      const admin = connect(container.config, "admin");
      try {
        await migrateDatabase(admin, passwords, folder);
        await expect(migrateDatabase(admin, passwords)).resolves.toBeUndefined();
      } finally {
        await admin.$client.end();
      }
    } finally {
      container.stop();
      rmSync(folder, { recursive: true, force: true });
    }
  }, 120_000);
});
