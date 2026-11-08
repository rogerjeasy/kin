/**
 * Placing a telephone call is a side effect Kin's code reaches through this
 * interface. The Twilio adapter implements it (`createTwilioOutboundCaller`),
 * tests use `fakeOutboundCaller`, and the calling code never knows which.
 *
 * Twilio's Calls.create has no idempotency key, so the adapter cannot make a
 * double call impossible; the caller must. The worker's rule:
 *
 * 1. Write one attempt row (shift, attempt number) under a unique constraint
 *    BEFORE calling `placeCall`. A second worker loses the insert and does not
 *    call.
 * 2. On success, store the returned `callSid` on that row. The sid is also what
 *    the status callback and the answer webhook carry, so it ties every later
 *    event back to the attempt.
 * 3. On `OutboundCallError`, read `mayHaveBeenPlaced`. When it is `false`
 *    Twilio refused the request and a retry is safe (when `retryable`). When it
 *    is `true` a call may be ringing: do not retry blindly. Leave the attempt
 *    as unknown and wait for its status callback, or ask Twilio for recent
 *    calls to that number, before deciding. Same rule as a payment that timed
 *    out: uncertain means stop.
 * 4. The sealed token in the call's address carries the attempt number, so a
 *    late webhook from an abandoned attempt can be told from the current one.
 */
export interface OutboundCaller {
  placeCall(request: PlaceCallRequest): Promise<PlacedCall>;
}

export type PlaceCallRequest = {
  /** The person to call, in E.164 form. */
  readonly to: string;
  /** Where Twilio fetches the TwiML when the call connects. HTTPS, publicly reachable. */
  readonly answerUrl: string;
  /** Where Twilio reports the call's progress and how it ended. HTTPS. */
  readonly statusUrl: string;
  /** How long to let it ring before giving up, in seconds. */
  readonly ringSeconds?: number;
  /** Ask Twilio whether a person or an answering machine picked up. On by default: a machine is never read a question. */
  readonly detectMachine?: boolean;
};

/** The call states of Twilio's Call resource. */
export const CALL_STATUSES = ["queued", "ringing", "in-progress", "completed", "busy", "failed", "no-answer", "canceled"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export type PlacedCall = {
  /** Twilio's ID of the call: `CA` and 32 hex characters. The worker stores it as the attempt's key. */
  readonly callSid: string;
  /** Normally `queued`. Not the outcome: only the status callback says whether anyone answered. */
  readonly status: CallStatus;
};

export type OutboundCallFailure =
  | "invalid_request" // Kin's own check refused the request before anything was sent
  | "bad_number" // Twilio refused the number
  | "refused" // Twilio refused the request or the account's permission
  | "unauthorized" // the credentials are wrong
  | "rate_limited" // Twilio's concurrency limit
  | "unavailable" // Twilio answered with a server error
  | "network" // the request never got an answer
  | "bad_response"; // Twilio said yes in a form Kin cannot read

/**
 * A call could not be placed. The message never holds a phone number, a
 * credential or Twilio's own wording (which can echo the number back);
 * `twilioCode` is the number of Twilio's error page for it.
 */
export class OutboundCallError extends Error {
  readonly reason: OutboundCallFailure;
  /** Whether trying again later can help. A bad number or a wrong credential never does. */
  readonly retryable: boolean;
  /** Whether Twilio may have accepted the call anyway. Retrying without checking can ring the phone twice. */
  readonly mayHaveBeenPlaced: boolean;
  readonly twilioCode: number | null;

  constructor(reason: OutboundCallFailure, flags: { retryable: boolean; mayHaveBeenPlaced: boolean; twilioCode?: number | null }) {
    super(`The call could not be placed: ${reason}`);
    this.name = "OutboundCallError";
    this.reason = reason;
    this.retryable = flags.retryable;
    this.mayHaveBeenPlaced = flags.mayHaveBeenPlaced;
    this.twilioCode = flags.twilioCode ?? null;
  }
}
