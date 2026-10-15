import { sql } from "drizzle-orm";

import type { Transaction } from "../connection.ts";

/** Every table Kin's migrations created, read from the catalog. */
export const PUBLIC_TABLES_SQL = sql`select tablename from pg_tables where schemaname = 'public' and tablename not like '\\_\\_%' order by tablename`;

/** Counts a table's rows that belong to a circle, as the transaction's role sees them. */
export async function countIn(tx: Transaction, table: string, circleId: string): Promise<number> {
  const column = table === "circles" ? "id" : "circle_id";
  const result = await tx.execute<{ count: string }>(sql`select count(*) from ${sql.identifier(table)} where ${sql.identifier(column)} = ${circleId}`);
  return Number(result.rows[0]?.count);
}

/** The PostgreSQL error code a promise failed with, or a note that it did not fail. */
export async function errorCode(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "no error";
  } catch (error) {
    return codeOf(error) ?? `uncoded: ${String(error)}`;
  }
}

function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? codeOf(error.cause) : null;
}

/** PostgreSQL's codes for the refusals these tests expect. */
export const REFUSED = {
  permission: "42501",
  check: "23514",
  restrict: "23001",
  unique: "23505",
  foreignKey: "23503",
} as const;
