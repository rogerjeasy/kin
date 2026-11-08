import { SHIFT_SETTLE_TOPIC, claimOutbox } from "@kin/db";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";
import { handleShiftSettle, type SettleDeps } from "./settle-shift.ts";

const BATCH = 10;
const LEASE_SECONDS = 60;

/**
 * Leases the confirmed shifts waiting in the outbox to be settled and settles
 * each. Returns how many it leased.
 */
export async function runSettleBatch(deps: SettleDeps, log: InboxLog): Promise<number> {
  const messages = await claimOutbox(deps.db, SHIFT_SETTLE_TOPIC, BATCH, LEASE_SECONDS);
  for (const message of messages) await handleShiftSettle(deps, log, message);
  return messages.length;
}
