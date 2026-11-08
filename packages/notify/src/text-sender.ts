/**
 * Sends one text message. Kin's code depends on this, never on a provider
 * directly: the Twilio adapter implements it (`createTwilioTextSender`) and
 * tests use `fakeTextSender`.
 *
 * Twilio's Messages.create has no idempotency key, so a double text can only
 * be prevented by the caller: record the intent (shift, kind, attempt) under a
 * unique constraint before sending, store the returned `messageSid` after, and
 * on a `TextDeliveryError` with `mayHaveBeenSent` do not resend blindly. The
 * same rule as for a call that may be ringing.
 */
export type TextSender = {
  send(message: TextMessage): Promise<SentText>;
};

export type TextMessage = {
  /** The recipient, in E.164 form: a plus, then 7 to 15 digits, the first not 0. */
  readonly to: string;
  readonly body: string;
};

export type SentText = {
  /** Twilio's ID of the message: `SM` or `MM` and 32 hex characters. Accepted for delivery, not yet delivered. */
  readonly messageSid: string;
};

const E164 = /^\+[1-9][0-9]{6,14}$/;

export const isE164 = (value: string): boolean => E164.test(value);

export type TextFailure =
  | "invalid_message" // Kin's own check refused the message before anything was sent
  | "bad_number" // the number is not one Twilio can text
  | "refused" // Twilio refused the message: a blocked recipient, a destination the account may not text
  | "unauthorized" // the credentials are wrong
  | "rate_limited" // Twilio's concurrency limit
  | "unavailable" // Twilio answered with a server error
  | "network" // the request never got an answer
  | "bad_response"; // Twilio said yes in a form Kin cannot read

/**
 * A text could not be sent. The message never holds a number, a message body, a
 * credential or Twilio's own wording (which can echo the number); `twilioCode` is
 * the number of Twilio's error page for it.
 */
export class TextDeliveryError extends Error {
  readonly reason: TextFailure;
  /** Whether trying again later can help. A bad number, a blocked recipient or a wrong credential never does. */
  readonly retryable: boolean;
  /** Whether Twilio may have accepted the message anyway. Retrying without checking can text twice. */
  readonly mayHaveBeenSent: boolean;
  readonly twilioCode: number | null;

  constructor(reason: TextFailure, flags: { retryable: boolean; mayHaveBeenSent: boolean; twilioCode?: number | null }) {
    super(`The text could not be sent: ${reason}`);
    this.name = "TextDeliveryError";
    this.reason = reason;
    this.retryable = flags.retryable;
    this.mayHaveBeenSent = flags.mayHaveBeenSent;
    this.twilioCode = flags.twilioCode ?? null;
  }
}
