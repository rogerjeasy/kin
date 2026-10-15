import { sql } from "drizzle-orm";

import type { Database, Transaction } from "./connection.ts";

/**
 * Every query runs inside one of these scopes. Each opens a transaction and
 * tells row-level security who is asking, for that transaction only, so a
 * pooled connection never carries one person's identity into the next query.
 */

/** As a signed-in person, through the `kin_app` role. */
export function asPerson<T>(db: Database, userId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('kin.user_id', ${requireText(userId, "user")}, true)`);
    return work(tx);
  });
}

/** As Kin's own service, for the one circle a job names, through `kin_service`. */
export function asService<T>(db: Database, circleId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('kin.circle_id', ${requireText(circleId, "circle")}, true)`);
    return work(tx);
  });
}

/** As the demo provisioner, which can only add a new circle, through `kin_provisioner`. */
export function asProvisioner<T>(db: Database, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(work);
}

function requireText(value: string, what: string): string {
  if (value.trim() === "") throw new Error(`A database scope needs a ${what} ID`);
  return value;
}
