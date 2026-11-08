import {
  SHIFT_HOLD_REASONS,
  ShiftError,
  asService,
  finishMessage,
  retryMessageLater,
  settleShiftAsService,
  type ClaimedMessage,
  type Database,
} from "@kin/db";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";
import { backoffSeconds, errorName, shiftIdOf } from "./shift-message.ts";

export type SettleDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
};

/**
 * Settles one shift whose two keys have turned with no person there to settle
 * it (a check-out by link, the parent's word by phone), as Kin's service for
 * that message's circle. The settling and the message's finish are one
 * transaction: they commit together or not at all, so a crash leaves the
 * message to come back and `settleShiftAsService` hands the proposal already
 * raised back, never a second one.
 *
 * What a refusal means:
 * - a hold (`SHIFT_HOLD_REASONS`: a paused circle, no agreement, a missing rate...)
 *   is a state the family can lift, so the shift stays confirmed, the keys are
 *   never undone, and the message comes back later with a growing delay;
 * - any other `ShiftError` (the shift is cancelled, is not paid care...) cannot
 *   be helped by waiting, so the message is finished with an error line that
 *   names the reason, for whoever reads the logs;
 * - anything else is unexpected and is retried with the same growing delay.
 */
export async function handleShiftSettle(deps: SettleDeps, log: InboxLog, message: ClaimedMessage): Promise<void> {
  const { circleId } = message;
  const shiftId = shiftIdOf(message.payload);
  if (shiftId === null) {
    log({ level: "error", message: "shift_settle.unreadable_message", messageId: message.id });
    await asService(deps.db, circleId, (tx) => finishMessage(tx, message.id));
    return;
  }
  try {
    await asService(deps.db, circleId, async (tx) => {
      const settled = await settleShiftAsService(tx, { circleId, shiftId });
      log({ level: "info", message: "shift_settle.settled", circleId, shiftId, outcome: settled.outcome });
      await finishMessage(tx, message.id);
    });
  } catch (error) {
    if (error instanceof ShiftError && !SHIFT_HOLD_REASONS.includes(error.reason)) {
      log({ level: "error", message: "shift_settle.refused", circleId, shiftId, reason: error.reason });
      await asService(deps.db, circleId, (tx) => finishMessage(tx, message.id));
      return;
    }
    const seconds = backoffSeconds(message.attempts);
    const held = error instanceof ShiftError ? { message: "shift_settle.held", reason: error.reason } : { message: "shift_settle.retry", error: errorName(error) };
    log({ level: error instanceof ShiftError ? "info" : "error", circleId, shiftId, seconds, ...held });
    await asService(deps.db, circleId, (tx) => retryMessageLater(tx, message.id, seconds));
  }
}
