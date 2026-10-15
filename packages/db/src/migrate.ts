import { DATABASE_ROLES, type DatabaseCredentials, type DatabaseRole } from "@kin/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";

import type { Database } from "./connection.ts";

/** Where the migrations live beside this file, and where a bundle copies them. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

type LoginRole = Exclude<DatabaseRole, "admin">;

/**
 * Brings the schema up to date as the admin, then lets each service role sign
 * in with the password from its secret. The passwords never enter a migration.
 */
export async function migrateDatabase(
  admin: Database,
  passwords: Readonly<Record<LoginRole, DatabaseCredentials["password"]>>,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  await migrate(admin, { migrationsFolder });
  const client = await admin.$client.connect();
  try {
    for (const role of Object.keys(passwords) as LoginRole[]) {
      const name = DATABASE_ROLES[role];
      const password = passwords[role];
      if (password.trim() === "") throw new Error(`The ${role} role has an empty password`);
      // ALTER ROLE takes no parameters, so both parts are escaped instead.
      await client.query(`ALTER ROLE ${client.escapeIdentifier(name)} WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
    }
  } finally {
    client.release();
  }
}
