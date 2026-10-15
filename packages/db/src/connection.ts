import type { DatabaseConfig, DatabaseRole } from "@kin/config";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema/index.ts";

export type Schema = typeof schema;

/** A connection pool for one database role, with Kin's schema. */
export type Database = NodePgDatabase<Schema> & { readonly $client: pg.Pool };

/** A transaction opened by one of the scopes in `scope.ts`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// Aurora Serverless resumes from zero capacity in about fifteen seconds.
const CONNECT_TIMEOUT_MS = 30_000;
const STATEMENT_TIMEOUT_MS = 15_000;
const POOL_SIZE = 5;

/** Opens a pool that connects as `role`. Nothing connects until the first query. */
export function connect<R extends DatabaseRole>(config: DatabaseConfig<R>, role: R): Database {
  const { user, password } = config.credentials[role];
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user,
    password,
    // Verified against the system's and NODE_EXTRA_CA_CERTS' authorities.
    ssl: config.tls ? { rejectUnauthorized: true } : false,
    max: POOL_SIZE,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: `kin-${role}`,
  });
  // A pooled connection that drops while idle is removed from the pool, and
  // the next query opens a new one. Without a listener the drop would end the
  // process; any query it affected fails on its own and reports it.
  pool.on("error", () => undefined);
  return drizzle({ client: pool, schema });
}
