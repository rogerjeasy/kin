// Brings a database up to date: `pnpm --filter @kin/db run migrate`.
// It reads the KIN_DATABASE_* settings from the root .env (see .env.example).
import { readDatabaseConfig } from "@kin/config";
import { sql } from "drizzle-orm";
import { setTimeout as sleep } from "node:timers/promises";

import { connect } from "../src/connection.ts";
import { migrateDatabase } from "../src/migrate.ts";
import { waitForDatabase } from "../src/wait-for-database.ts";

// A paused Aurora cluster resumes on the first connection; give it time.
const RESUME_DEADLINE_MS = 5 * 60 * 1000;
const RETRY_INTERVAL_MS = 10 * 1000;

const config = readDatabaseConfig(process.env, ["admin", "app", "service", "provisioner"]);
const admin = connect(config, "admin");
try {
  const { attempts, waitedMs } = await waitForDatabase(
    async () => {
      await admin.execute(sql`select 1`);
    },
    { deadlineMs: RESUME_DEADLINE_MS, intervalMs: RETRY_INTERVAL_MS, now: Date.now, sleep: (ms) => sleep(ms) },
  );
  console.log(`The database answered after ${attempts} attempt(s), ${Math.round(waitedMs / 1000)} seconds of waiting`);
  await migrateDatabase(admin, {
    app: config.credentials.app.password,
    service: config.credentials.service.password,
    provisioner: config.credentials.provisioner.password,
  });
  console.log(`Migrated ${config.database} on ${config.host}:${config.port}`);
} finally {
  await admin.$client.end();
}
