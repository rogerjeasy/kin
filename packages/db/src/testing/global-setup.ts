import type { TestProject } from "vitest/node";

import { connect } from "../connection.ts";
import { migrateDatabase } from "../migrate.ts";
import { startPostgres } from "./postgres-container.ts";

/** One migrated PostgreSQL for the whole run, the way a deployment migrates it. */
export default async function setup(project: TestProject): Promise<() => void> {
  const container = await startPostgres();
  try {
    const { credentials } = container.config;
    const admin = connect(container.config, "admin");
    await migrateDatabase(admin, {
      app: credentials.app.password,
      service: credentials.service.password,
      provisioner: credentials.provisioner.password,
    });
    await admin.$client.end();
    project.provide("database", container.config);
  } catch (error) {
    container.stop();
    throw error;
  }
  return () => container.stop();
}
