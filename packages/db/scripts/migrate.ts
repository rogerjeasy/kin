// Brings a database up to date: `pnpm --filter @kin/db run migrate`.
// It reads the KIN_DATABASE_* settings from the root .env (see .env.example).
import { readDatabaseConfig } from "@kin/config";

import { connect } from "../src/connection.ts";
import { migrateDatabase } from "../src/migrate.ts";

const config = readDatabaseConfig(process.env, ["admin", "app", "service", "provisioner"]);
const admin = connect(config, "admin");
try {
  await migrateDatabase(admin, {
    app: config.credentials.app.password,
    service: config.credentials.service.password,
    provisioner: config.credentials.provisioner.password,
  });
  console.log(`Migrated ${config.database} on ${config.host}:${config.port}`);
} finally {
  await admin.$client.end();
}
