import type { ShiftCallAnswer, ShiftCallState, ShiftState } from "@kin/domain";
import { sql } from "drizzle-orm";

import type { Transaction } from "./connection.ts";
import { callOperation } from "./shift-call-errors.ts";

/**
 * Kin's phone call to the parent for the family's word on a shift. The parent
 * switches it on, with consent, as a person (`setParentCallSettings`). Everything
 * else here is for Kin's own service, inside `asService`: the database refuses
 * each of them to any person and for any circle but the one in scope.
 */

/** Switches the parent's call on or off. Run as the person, inside `asPerson`. */
export async function setParentCallSettings(
  tx: Transaction,
  input: { readonly circleId: string; readonly phone: string | null; readonly enabled: boolean; readonly consent: boolean },
): Promise<void> {
  await callOperation(() =>
    tx.execute(sql`select kin_private.set_parent_call_settings(${input.circleId}::uuid, ${input.phone}, ${input.enabled}, ${input.consent})`),
  );
}

/** Everything the worker needs to dial and greet the parent. The number is for dialing only: never log it, store it or send it to a screen. */
export type ShiftCallToDial = {
  readonly kind: "dial";
  readonly callId: string;
  readonly attempt: number;
  readonly shiftId: string;
  readonly phone: string;
  readonly locale: string;
  readonly parentMemberId: string;
  readonly parentFirstName: string;
  readonly caregiverFirstName: string;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly checkedInAt: Date;
  readonly checkedOutAt: Date;
};

/** Why Kin will not place the call now. `retryAt` is set when waiting helps: the end of quiet hours, or of the wait before a second attempt. */
export type ShiftCallRefusal = {
  readonly kind: "refused";
  readonly reason: ShiftCallRefusalReason;
  readonly retryAt: Date | null;
};

export type ShiftCallRefusalReason =
  | "demo_circle"
  | "not_waiting"
  | "expired"
  | "not_enabled"
  | "no_parent"
  | "declined"
  | "in_progress"
  | "attempts_exhausted"
  | "too_soon"
  | "quiet_hours";

const REFUSAL_REASONS: readonly string[] = [
  "demo_circle", "not_waiting", "expired", "not_enabled", "no_parent", "declined", "in_progress", "attempts_exhausted", "too_soon", "quiet_hours",
];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: Record<string, unknown>, key: string): string {
  const found = value[key];
  if (typeof found !== "string") throw new Error(`The call's ${key} is not text`);
  return found;
}

function parseStart(raw: unknown): ShiftCallToDial | ShiftCallRefusal {
  if (!isObject(raw)) throw new Error("Starting a call returned nothing");
  if (raw["ok"] !== true) {
    const reason = text(raw, "reason");
    if (!REFUSAL_REASONS.includes(reason)) throw new Error(`Starting a call returned an unknown reason: ${reason}`);
    const retryAt = raw["retryAt"];
    // Safe: the list above holds exactly the reasons the type names.
    return { kind: "refused", reason: reason as ShiftCallRefusalReason, retryAt: typeof retryAt === "string" ? new Date(retryAt) : null };
  }
  const attempt = raw["attempt"];
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt)) throw new Error("The call's attempt is not a whole number");
  return {
    kind: "dial",
    callId: text(raw, "callId"),
    attempt,
    shiftId: text(raw, "shiftId"),
    phone: text(raw, "phone"),
    locale: text(raw, "locale"),
    parentMemberId: text(raw, "parentMemberId"),
    parentFirstName: text(raw, "parentFirstName"),
    caregiverFirstName: text(raw, "caregiverFirstName"),
    timezone: text(raw, "timezone"),
    startsAt: new Date(text(raw, "startsAt")),
    endsAt: new Date(text(raw, "endsAt")),
    checkedInAt: new Date(text(raw, "checkedInAt")),
    checkedOutAt: new Date(text(raw, "checkedOutAt")),
  };
}

/**
 * Starts Kin's call to the parent about a shift, for the worker that leased a
 * `SHIFT_CALL_TOPIC` message. Returns what is needed to dial, and records the
 * attempt as queued, or says why not (a shift that already has the family's word,
 * quiet hours, a call under way, two attempts used, a demo circle, no consent...).
 * A refusal is a value, not an error, so the worker can finish or delay its message.
 * `now` is accepted for symmetry with `settleShift` and is not what the decision rests on: the circle's own clock is.
 */
export async function startShiftCall(tx: Transaction, input: { readonly circleId: string; readonly shiftId: string; readonly now?: Date }): Promise<ShiftCallToDial | ShiftCallRefusal> {
  const result = await callOperation(() =>
    tx.execute<{ started: unknown }>(sql`select kin_private.start_shift_call(${input.circleId}::uuid, ${input.shiftId}::uuid) as started`),
  );
  return parseStart(result.rows[0]?.started);
}

/** The telephony provider took the call and gave it an ID, which a word spoken on it is recorded against. Saying it again changes nothing. */
export async function recordCallPlaced(tx: Transaction, input: { readonly circleId: string; readonly shiftId: string; readonly callId: string; readonly callSid: string }): Promise<void> {
  await callOperation(() =>
    tx.execute(sql`select kin_private.record_call_placed(${input.circleId}::uuid, ${input.shiftId}::uuid, ${input.callId}::uuid, ${input.callSid})`),
  );
}

export type CallReport = "answered" | "no_answer" | "failed";

/**
 * How a call went, as the provider reports it. Without a `callSid` it is the
 * call that was never placed (the dial itself failed). A call already over
 * stays as it is, so a late or repeated report is harmless. When a first attempt
 * ends without a word and the shift still waits for it, the database queues the
 * second for later (`SHIFT_CALL_TOPIC`); `retryAt` says when.
 */
export async function recordCallStatus(
  tx: Transaction,
  input: { readonly circleId: string; readonly shiftId: string; readonly callSid: string | null; readonly status: CallReport; readonly error?: string | null },
): Promise<{ readonly state: ShiftCallState; readonly retryAt: Date | null }> {
  const result = await callOperation(() =>
    tx.execute<{ recorded: unknown }>(sql`select kin_private.record_call_status(
      ${input.circleId}::uuid, ${input.shiftId}::uuid, ${input.callSid}, ${input.status}, ${input.error ?? null}) as recorded`),
  );
  const recorded = result.rows[0]?.recorded;
  if (!isObject(recorded)) throw new Error("Recording a call returned nothing");
  const retryAt = recorded["retryAt"];
  // Safe: the database holds a call's state to the domain's list.
  return { state: text(recorded, "state") as ShiftCallState, retryAt: typeof retryAt === "string" ? new Date(retryAt) : null };
}

/** What recording the parent's answer brought about. */
export type FamilyWordByCall = {
  /** `confirmed`: her yes is the shift's second key. `declined`: she said no. `unclear`: nothing recorded. `already_in`: someone's word was already in and never changes. */
  readonly outcome: "confirmed" | "declined" | "unclear" | "already_in";
  /** This answer changed a record; `false` for an answer said again, an unclear one and one that was already in. */
  readonly recorded: boolean;
  readonly shiftState: ShiftState;
};

const OUTCOMES: readonly string[] = ["confirmed", "declined", "unclear", "already_in"];

/**
 * Records the parent's spoken answer on a call Kin placed. A clear yes is the
 * parent's word, with the call's ID as evidence; if the caregiver's key has turned
 * the shift is confirmed and its settling queued for the worker (`SHIFT_SETTLE_TOPIC`).
 * A no records a declined call and pays nothing. An unclear answer records nothing.
 * The word never changes once set, and only the circle's active parent, with the
 * call switched on, can give it: nobody else's yes is recorded as hers.
 */
export async function recordFamilyWordByCall(
  tx: Transaction,
  input: { readonly circleId: string; readonly shiftId: string; readonly callSid: string; readonly answer: ShiftCallAnswer },
): Promise<FamilyWordByCall> {
  const result = await callOperation(() =>
    tx.execute<{ word: unknown }>(sql`select kin_private.record_family_word_by_call(
      ${input.circleId}::uuid, ${input.shiftId}::uuid, ${input.callSid}, ${input.answer}) as word`),
  );
  const word = result.rows[0]?.word;
  if (!isObject(word)) throw new Error("Recording the family's word returned nothing");
  const outcome = text(word, "outcome");
  if (!OUTCOMES.includes(outcome)) throw new Error(`Recording the family's word returned an unknown outcome: ${outcome}`);
  // Safe: the list above holds exactly the outcomes the type names, and the enum the shift's state.
  return { outcome: outcome as FamilyWordByCall["outcome"], recorded: word["recorded"] === true, shiftState: text(word, "shiftState") as ShiftState };
}
