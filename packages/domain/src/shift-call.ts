/**
 * Kin's phone call to the parent for the family's word on a shift
 * (docs/architecture.md, care shifts). One call row is one attempt.
 *
 * `queued`: Kin decided to call; the number has not been dialed.
 * `calling`: the telephony provider has the call.
 * `answered`: someone picked up; no word has been recorded yet.
 * `confirmed`: the parent said yes, and her word is the shift's second key.
 * `declined`: the parent said no. Nothing is paid; the family is told.
 * `no_answer`, `failed`: the call ended with no word. A second attempt may follow.
 */
export const SHIFT_CALL_TRANSITIONS = {
  queued: ["calling", "failed"],
  calling: ["answered", "confirmed", "declined", "no_answer", "failed"],
  answered: ["confirmed", "declined", "failed"],
  confirmed: [],
  declined: [],
  no_answer: [],
  failed: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type ShiftCallState = keyof typeof SHIFT_CALL_TRANSITIONS;

export const SHIFT_CALL_STATES = Object.keys(SHIFT_CALL_TRANSITIONS) as [ShiftCallState, ...ShiftCallState[]];

/** What the call flow understood the parent to say. Only a clear yes is a word; "unclear" records nothing. */
export const SHIFT_CALL_ANSWERS = ["yes", "no", "unclear"] as const;
export type ShiftCallAnswer = (typeof SHIFT_CALL_ANSWERS)[number];

/** Kin tries a shift's call at most twice. */
export const MAX_SHIFT_CALL_ATTEMPTS = 2;

/** The wait before a second attempt, and the end of a call's usefulness: after this a visit's word is asked on screen. */
export const SHIFT_CALL_RETRY_MINUTES = 30;
export const SHIFT_CALL_WINDOW_HOURS = 24;

/** Whether a call may move from one state to another. Staying put is not a move. */
export function shiftCallMayMove(from: ShiftCallState, to: ShiftCallState): boolean {
  return (SHIFT_CALL_TRANSITIONS[from] as readonly ShiftCallState[]).includes(to);
}

/** A call that may still bring a word. */
export const shiftCallIsActive = (state: ShiftCallState): boolean => state === "queued" || state === "calling" || state === "answered";
