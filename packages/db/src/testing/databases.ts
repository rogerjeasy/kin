import type { DatabaseConfig } from "@kin/config";
import { afterAll, inject } from "vitest";

import { connect, type Database } from "../connection.ts";

declare module "vitest" {
  export interface ProvidedContext {
    database: DatabaseConfig;
  }
}

export type TestDatabases = {
  readonly admin: Database;
  readonly app: Database;
  readonly service: Database;
  readonly provisioner: Database;
};

/** A pool per role on the run's database, closed when the file's tests end. */
export function testDatabases(): TestDatabases {
  const config = inject("database");
  const databases = {
    admin: connect(config, "admin"),
    app: connect(config, "app"),
    service: connect(config, "service"),
    provisioner: connect(config, "provisioner"),
  };
  afterAll(async () => {
    await Promise.all(Object.values(databases).map((db) => db.$client.end()));
  });
  return databases;
}
