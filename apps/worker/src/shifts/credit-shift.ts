import { asService, creditShift, finishMessage, retryMessageLater, type ClaimedMessage, type Database } from "@kin/db";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";
import { backoffSeconds, errorName, shiftIdOf } from "./shift-message.ts";

export type CreditDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
};

/**
 * Credits one confirmed visit as care time and finishes its message, in one
 * transaction for that circle: the ledger entry, the care entry, the move to
 * credited and the message all commit together or not at all, so a crash
 * leaves the message to be handed out again and the visit credited once. A
 * failure backs the message off, as a payout's does.
 */
export async function handleShiftCredit(deps: CreditDeps, log: InboxLog, message: ClaimedMessage): Promise<void> {
  const shiftId = shiftIdOf(message.payload);
  if (shiftId === null) {
    log({ level: "error", message: "shift_credit.unreadable_message", messageId: message.id });
    await asService(deps.db, message.circleId, (tx) => finishMessage(tx, message.id));
    return;
  }
  try {
    await asService(deps.db, message.circleId, async (tx) => {
      const outcome = await creditShift(tx, message.circleId, shiftId);
      log({ level: "info", message: `shift_credit.${outcome}`, circleId: message.circleId, shiftId });
      await finishMessage(tx, message.id);
    });
  } catch (error) {
    const seconds = backoffSeconds(message.attempts);
    // Never a database error's message: it can quote the query's values (AGENTS.md section 6).
    log({ level: "error", message: "shift_credit.retry", circleId: message.circleId, shiftId, seconds, error: errorName(error) });
    await asService(deps.db, message.circleId, (tx) => retryMessageLater(tx, message.id, seconds));
  }
}
