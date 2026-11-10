import { readDatabaseConfig } from "@kin/config";
import { connect } from "@kin/db";

import { payPurseAsWorker } from "../../../../packages/db/src/testing/purse.ts";
import { E2E_DATABASE } from "./database-settings.ts";

/**
 * Does what Kin's worker does once a demo circle's Purse payment is approved:
 * pays it, simulated, as the worker's own service identity. No worker runs
 * beside the end-to-end app, so a test that needs the payment to turn "sent"
 * on screen calls this for the payment it is looking at, found by the ID its
 * row carries in its own element ID.
 */
export async function payPurseAs(paymentId: string): Promise<number> {
  const inherited = process.env[E2E_DATABASE.envKey];
  if (!inherited) throw new Error("The end-to-end database settings were not passed to this worker");
  const env = JSON.parse(inherited) as Record<string, string>;
  const admin = connect(readDatabaseConfig(env, ["admin"]), "admin");
  const service = connect(readDatabaseConfig(env, ["service"]), "service");
  try {
    const found = await admin.$client.query<{ circle_id: string }>("select circle_id from purse_payments where id = $1", [paymentId]);
    const row = found.rows[0];
    if (!row) throw new Error("No Purse payment with that ID");
    return await payPurseAsWorker(service, row.circle_id);
  } finally {
    await Promise.all([admin.$client.end(), service.$client.end()]);
  }
}
