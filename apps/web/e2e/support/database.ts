import { createServer } from "node:http";

import { readDatabaseConfig } from "@kin/config";
import { connect } from "@kin/db";
import { migrateDatabase } from "@kin/db/migrate";
import { startPostgres } from "@kin/db/testing/postgres-container";

import { E2E_DATABASE } from "./database-settings.ts";

/**
 * A throwaway PostgreSQL for the end-to-end tests, migrated the way a
 * deployment migrates it. Playwright starts it as a web server and reads its
 * health; stopping it removes the container. Settings come from the
 * environment playwright.config.ts gives it.
 */
const config = readDatabaseConfig(process.env, ["admin", "app", "service", "provisioner"]);
const container = await startPostgres({ port: config.port, credentials: config.credentials });
const admin = connect(container.config, "admin");
await migrateDatabase(admin, {
  app: config.credentials.app.password,
  service: config.credentials.service.password,
  provisioner: config.credentials.provisioner.password,
});
await admin.$client.end();

const health = createServer((_, response) => response.writeHead(200).end("ok")).listen(E2E_DATABASE.healthPort);
const stop = () => {
  health.close();
  container.stop();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
