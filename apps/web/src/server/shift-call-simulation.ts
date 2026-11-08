import type { CircleSnapshot } from "@kin/db";
import { dayPart } from "@kin/domain";
import { isOfficeLocale, shiftCallSentences, type ShiftCallSentences } from "@kin/telephony";

import { mayHearCall } from "./shift-access";
import { uuidField } from "./shift-input";

/**
 * What Kin says on a call about a visit, for a demo circle to hear without a
 * phone. A demo circle never places a real call; this is the same sentences
 * the real call speaks, built from the same function and the same record, so
 * the demo and the call cannot drift apart. Nothing here is typed by a person.
 */
export type SimulatedCall = ShiftCallSentences;

export type SimulationFailure = "refused" | "invalid" | "wrong_state";

const firstNameOf = (displayName: string): string => displayName.trim().split(/\s+/u)[0] ?? displayName;

/** The sentences of the call about one shift, in one language, or why not. A real circle is refused: it gets the real call. */
export function simulatedCall(circle: CircleSnapshot, shiftId: unknown, locale: unknown): { readonly ok: true; readonly call: SimulatedCall } | { readonly ok: false; readonly reason: SimulationFailure } {
  const id = uuidField(shiftId);
  if (id === null || typeof locale !== "string" || !isOfficeLocale(locale)) return { ok: false, reason: "invalid" };
  if (!circle.circle.demo) return { ok: false, reason: "refused" };
  const shift = circle.shifts.find((each) => each.id === id);
  if (shift === undefined) return { ok: false, reason: "refused" };
  if (!mayHearCall(circle, shift)) return { ok: false, reason: "wrong_state" };
  const caregiver = circle.members.find((member) => member.id === shift.memberId);
  return {
    ok: true,
    call: shiftCallSentences({ locale, caregiverName: firstNameOf(caregiver?.displayName ?? ""), dayPart: dayPart(shift.startsAt, circle.circle.timezone), contactName: null }),
  };
}
