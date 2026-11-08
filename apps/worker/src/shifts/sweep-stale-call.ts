import { asService, findStaleShiftCall, recordCallStatus, type Database } from "@kin/db";

/** A call is rung for seconds and talked on for minutes. One with no report after this long has lost its report for good. */
export const STALE_CALL_MINUTES = 30;

/**
 * Gives up on a shift's call attempt that has gone quiet: it was queued,
 * dialed or answered more than `STALE_CALL_MINUTES` ago and neither the dial's
 * outcome nor the telephony provider's report ever reached Kin (a dial whose
 * answer was lost, a status callback that never came). Left alone, that one
 * lost report would keep the shift's attempt "in progress" for ever and block
 * the second attempt. The attempt is recorded as failed through the database's
 * own operation, which queues the second attempt for after its wait. It cannot
 * ring a phone, so it is safe whatever the attempt's real fate: a late report
 * for a call already over changes nothing. Returns whether it gave up on one.
 */
export async function sweepStaleCall(db: Database, circleId: string, shiftId: string): Promise<boolean> {
  return asService(db, circleId, async (tx) => {
    const stale = await findStaleShiftCall(tx, { circleId, shiftId, staleMinutes: STALE_CALL_MINUTES });
    if (stale === null) return false;
    await recordCallStatus(tx, { circleId, shiftId, callSid: stale.callSid, status: "failed", error: "no_report" });
    return true;
  });
}
