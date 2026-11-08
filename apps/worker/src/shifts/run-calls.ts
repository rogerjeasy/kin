import { SHIFT_CALL_TOPIC, claimOutbox } from "@kin/db";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";
import { handleShiftCall, type CallDeps } from "./place-call.ts";

const BATCH = 5;
// A call is placed and recorded in a few seconds; a lease that outlives a slow Twilio answer lets no second worker take it.
const LEASE_SECONDS = 120;

/**
 * Leases the shifts waiting for Kin's call to the parent and places each.
 * Returns how many it leased.
 */
export async function runCallBatch(deps: CallDeps, log: InboxLog): Promise<number> {
  const messages = await claimOutbox(deps.db, SHIFT_CALL_TOPIC, BATCH, LEASE_SECONDS);
  for (const message of messages) await handleShiftCall(deps, log, message);
  return messages.length;
}
