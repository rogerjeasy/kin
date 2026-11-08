import { SHIFT_CREDIT_TOPIC, claimOutbox } from "@kin/db";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";
import { handleShiftCredit, type CreditDeps } from "./credit-shift.ts";

const BATCH = 10;
const LEASE_SECONDS = 60;

/**
 * Leases the confirmed visits and drives waiting in the outbox and credits
 * each as care time to the member who gave it. Returns how many it leased.
 */
export async function runCreditBatch(deps: CreditDeps, log: InboxLog): Promise<number> {
  const messages = await claimOutbox(deps.db, SHIFT_CREDIT_TOPIC, BATCH, LEASE_SECONDS);
  for (const message of messages) await handleShiftCredit(deps, log, message);
  return messages.length;
}
