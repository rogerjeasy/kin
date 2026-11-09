import { asService, readDuePresenceCalls, recordPresenceCallSid, startPresenceCall, type Database } from "@kin/db";
import { OutboundCallError, isOfficeLocale, presenceAskUrl, sealPresenceAskToken, type OutboundCaller } from "@kin/telephony";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

export type PresenceCallDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly caller: OutboundCaller;
  /** The phone service's https address with no trailing slash, where Twilio fetches the call's answer and status. */
  readonly publicUrl: string;
  /** Seals the call's token. The phone service opens it with the same key. */
  readonly tokenKey: string;
  readonly now: () => Date;
};

/** A phone left ringing this long without an answer is given up: the text and its link are still there. */
const RING_SECONDS = 25;

/**
 * Rings the real person for each check whose text went unanswered for thirty seconds, once.
 *
 * The order keeps the phone from ringing twice. The database commits that a call is being tried
 * (`startPresenceCall`) and refuses to say so a second time; only then is Twilio asked, and Twilio has no idempotency key.
 * So a crash after the dial and before the call's ID was stored leaves an attempt with no ID and nothing dials again, and
 * an error that says a call may have been placed is never retried, whatever its `retryable` flag says. A call that fails
 * leaves the check as it is: the family is told "could not be reached" when its ninety seconds end, and the person's text
 * still carries the link. Never logged: the number, the sealed token, the addresses, Twilio's own words.
 *
 * Returns how many calls it placed.
 */
export async function runPresenceCalls(deps: PresenceCallDeps, log: InboxLog): Promise<number> {
  let placed = 0;
  for (const due of await readDuePresenceCalls(deps.db)) {
    const facts = await asService(deps.db, due.circleId, (tx) => startPresenceCall(tx, due.circleId, due.checkId));
    if (facts === null) continue;
    const locale = isOfficeLocale(facts.locale) ? facts.locale : "en";
    const token = sealPresenceAskToken({ circleId: due.circleId, checkId: due.checkId, locale, reasked: 0 }, deps.tokenKey, deps.now().getTime());
    try {
      const call = await deps.caller.placeCall({
        to: facts.phone,
        answerUrl: presenceAskUrl(deps.publicUrl, "answer", token),
        statusUrl: presenceAskUrl(deps.publicUrl, "status", token),
        ringSeconds: RING_SECONDS,
      });
      await asService(deps.db, due.circleId, (tx) => recordPresenceCallSid(tx, due.circleId, due.checkId, call.callSid));
      placed += 1;
      log({ level: "info", message: "presence.call_placed", circleId: due.circleId });
    } catch (error) {
      const delivery = error instanceof OutboundCallError ? error : null;
      log({ level: "error", message: "presence.call_failed", circleId: due.circleId, reason: delivery?.reason ?? (error instanceof Error ? error.name : "unknown"), mayHaveBeenPlaced: delivery?.mayHaveBeenPlaced ?? null });
    }
  }
  return placed;
}
