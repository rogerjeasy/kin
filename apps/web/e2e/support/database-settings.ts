import { randomBytes } from "node:crypto";

import { E2E_PORTS } from "./ports";

/** Where the end-to-end database listens, and where it reports that it is ready. */
export const E2E_DATABASE = { port: E2E_PORTS.database, healthPort: E2E_PORTS.databaseHealth, envKey: "KIN_E2E_DATABASE" } as const;

const secret = () => randomBytes(18).toString("base64url");

/**
 * The settings the database and the app are both started with: fresh
 * passwords for each run, for a database on this machine only.
 */
export function e2eDatabaseEnv(): Record<string, string> {
  return {
    KIN_DATABASE_HOST: "127.0.0.1",
    KIN_DATABASE_PORT: String(E2E_DATABASE.port),
    KIN_DATABASE_NAME: "kin",
    KIN_DATABASE_TLS: "off",
    KIN_DATABASE_ADMIN_USER: "postgres",
    KIN_DATABASE_ADMIN_PASSWORD: secret(),
    KIN_DATABASE_APP_PASSWORD: secret(),
    KIN_DATABASE_SERVICE_PASSWORD: secret(),
    KIN_DATABASE_PROVISIONER_PASSWORD: secret(),
  };
}
