import { readDatabaseConfig } from "@kin/config";
import { connect } from "@kin/db";

import { payAsWorker } from "../../../../packages/db/src/testing/shifts.ts";
import { E2E_DATABASE } from "./database-settings.ts";

/**
 * Does what Kin's worker does once PayPal has paid a shift's payout: begins
 * it, sends it and confirms it, as the worker's own service identity. No
 * worker runs beside the end-to-end app, so a test that needs the shift to
 * turn "paid" on screen calls this for the shift it is looking at. The shift
 * is found by its ID, which a shift card carries in its own element ID.
 */
export async function payShiftAsWorker(shiftId: string): Promise<void> {
  const inherited = process.env[E2E_DATABASE.envKey];
  if (!inherited) throw new Error("The end-to-end database settings were not passed to this worker");
  const env = JSON.parse(inherited) as Record<string, string>;
  const admin = connect(readDatabaseConfig(env, ["admin"]), "admin");
  const service = connect(readDatabaseConfig(env, ["service"]), "service");
  try {
    const found = await admin.$client.query<{ circle_id: string; proposal_id: string }>("select circle_id, proposal_id from shifts where id = $1", [shiftId]);
    const row = found.rows[0];
    if (!row?.proposal_id) throw new Error("The shift has no payment to make yet");
    // The helper reads only the service pool; the other three are the admin's, never used.
    await payAsWorker({ admin, app: admin, service, provisioner: admin }, row.circle_id, row.proposal_id);
  } finally {
    await Promise.all([admin.$client.end(), service.$client.end()]);
  }
}
