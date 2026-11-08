import {
  ShiftCallError,
  asService,
  finishMessage,
  recordCallPlaced,
  recordCallStatus,
  retryMessageLater,
  startShiftCall,
  type ClaimedMessage,
  type Database,
  type ShiftCallToDial,
} from "@kin/db";
import { OutboundCallError, isOfficeLocale, sealShiftCallToken, shiftCallUrl, type OutboundCaller, type PlacedCall } from "@kin/telephony";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";
import { backoffSeconds, errorName, shiftIdOf } from "./shift-message.ts";
import { sweepStaleCall } from "./sweep-stale-call.ts";

export type CallDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly caller: OutboundCaller;
  /** The phone service's https address with no trailing slash, where Twilio fetches the call's answer and status. */
  readonly publicUrl: string;
  /** Seals the call's token. The phone service opens it with the same key. */
  readonly tokenKey: string;
  readonly now: () => Date;
  /** Waits between two tries when Twilio's concurrency limit refuses a call. */
  readonly pause: (ms: number) => Promise<void>;
};

/** A call in progress is looked at again after this: a few minutes. */
export const IN_PROGRESS_RETRY_SECONDS = 300;
/**
 * After a call is placed, or may have been, its message is not finished but
 * comes back once the attempt would be stale: that visit is the one that gives
 * up on an attempt whose report was lost (`sweepStaleCall`), so a lost report
 * cannot leave the shift without its second attempt.
 */
export const WATCH_SECONDS = 31 * 60;
/** Twilio's concurrency limit (429) refused the call before accepting it, so asking again cannot ring twice. */
const RATE_LIMIT_TRIES = 3;
const RATE_LIMIT_PAUSE_MS = 2_000;

/**
 * Places Kin's call to the parent for one `shift.call` message, once.
 *
 * The order is what keeps the phone from ringing twice. The database inserts
 * the attempt as `queued` in its own committed transaction (`startShiftCall`)
 * and refuses another call for the shift while one is queued, calling or
 * answered. Only then is Twilio asked, and Twilio has no idempotency key. So a
 * crash after the dial and before the ID was stored leaves a queued attempt,
 * the message comes back, the database says `in_progress`, and nothing is
 * dialed again. An error that says a call may have been placed is treated the
 * same way: it is never retried, whatever its `retryable` flag says.
 *
 * Never logged: the number, the sealed token, the addresses, Twilio's text.
 */
export async function handleShiftCall(deps: CallDeps, log: InboxLog, message: ClaimedMessage): Promise<void> {
  const { circleId } = message;
  const shiftId = shiftIdOf(message.payload);
  if (shiftId === null) {
    log({ level: "error", message: "shift_call.unreadable_message", messageId: message.id });
    await asService(deps.db, circleId, (tx) => finishMessage(tx, message.id));
    return;
  }
  const later = (seconds: number) => asService(deps.db, circleId, (tx) => retryMessageLater(tx, message.id, seconds));
  const done = () => asService(deps.db, circleId, (tx) => finishMessage(tx, message.id));
  try {
    if (await sweepStaleCall(deps.db, circleId, shiftId)) log({ level: "error", message: "shift_call.gave_up_on_stale_attempt", circleId, shiftId });
    const started = await asService(deps.db, circleId, (tx) => startShiftCall(tx, { circleId, shiftId }));
    if (started.kind === "refused") {
      log({ level: "info", message: "shift_call.refused", circleId, shiftId, reason: started.reason });
      if (started.reason === "in_progress") return await later(IN_PROGRESS_RETRY_SECONDS);
      if (started.retryAt !== null && (started.reason === "too_soon" || started.reason === "quiet_hours")) return await later(secondsUntil(started.retryAt, deps.now()));
      return await done();
    }
    return await dial(deps, log, message, started, { later, done });
  } catch (error) {
    const seconds = backoffSeconds(message.attempts);
    // Never a database error's message: it can quote the query's values (AGENTS.md section 6).
    log({ level: "error", message: "shift_call.retry", circleId, shiftId, seconds, error: errorName(error) });
    await later(seconds);
  }
}

const secondsUntil = (at: Date, now: Date): number => Math.max(1, Math.ceil((at.getTime() - now.getTime()) / 1000));

type Settle = { readonly later: (seconds: number) => Promise<void>; readonly done: () => Promise<void> };

async function dial(deps: CallDeps, log: InboxLog, message: ClaimedMessage, call: ShiftCallToDial, settle: Settle): Promise<void> {
  const { circleId } = message;
  const { shiftId, callId, attempt } = call;
  const token = sealShiftCallToken({ circleId, shiftId, attempt, locale: isOfficeLocale(call.locale) ? call.locale : "en", reasked: 0 }, deps.tokenKey, deps.now().getTime());
  const request = { to: call.phone, answerUrl: shiftCallUrl(deps.publicUrl, "answer", token), statusUrl: shiftCallUrl(deps.publicUrl, "status", token) };

  let placed: PlacedCall;
  try {
    placed = await placeWithRateLimitRetries(deps, request);
  } catch (error) {
    if (error instanceof OutboundCallError && !error.mayHaveBeenPlaced) {
      // Twilio refused it for good (or kept refusing it): nothing is ringing. The attempt ends failed, and the
      // database queues the second one for after its wait, when it may still be allowed.
      log({ level: "error", message: "shift_call.refused_by_provider", circleId, shiftId, callId, attempt, reason: error.reason, twilioCode: error.twilioCode });
      await asService(deps.db, circleId, (tx) => recordCallStatus(tx, { circleId, shiftId, callSid: null, status: "failed", error: error.reason }));
      return settle.done();
    }
    // A call may be ringing. Never dial again: the attempt stays queued, the message comes back to look at it, and
    // either Twilio's status report resolves it or the visit after `WATCH_SECONDS` gives up on it.
    log({ level: "error", message: "shift_call.dial_unknown", circleId, shiftId, callId, attempt, reason: error instanceof OutboundCallError ? error.reason : errorName(error) });
    return settle.later(WATCH_SECONDS);
  }
  try {
    await asService(deps.db, circleId, (tx) => recordCallPlaced(tx, { circleId, shiftId, callId, callSid: placed.callSid }));
  } catch (error) {
    // The call is ringing. A webhook may already have recorded it or even ended it; otherwise the attempt stays queued
    // and the database refuses a second dial. Either way the visit after `WATCH_SECONDS` settles what is left.
    if (!(error instanceof ShiftCallError && error.reason === "call_over")) {
      log({ level: "error", message: "shift_call.record_failed", circleId, shiftId, callId, attempt, error: errorName(error) });
    }
  }
  log({ level: "info", message: "shift_call.placed", circleId, shiftId, callId, attempt });
  return settle.later(WATCH_SECONDS);
}

async function placeWithRateLimitRetries(deps: CallDeps, request: Parameters<OutboundCaller["placeCall"]>[0]): Promise<PlacedCall> {
  for (let tries = 1; ; tries += 1) {
    try {
      return await deps.caller.placeCall(request);
    } catch (error) {
      // Only a refusal Twilio made before taking the call may be asked again.
      if (!(error instanceof OutboundCallError) || error.reason !== "rate_limited" || error.mayHaveBeenPlaced || tries >= RATE_LIMIT_TRIES) throw error;
      await deps.pause(RATE_LIMIT_PAUSE_MS);
    }
  }
}
