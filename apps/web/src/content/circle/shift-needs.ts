import type { CircleSnapshot } from "@kin/db";
import type { ShiftKind } from "@kin/domain";

import type { NeedItem } from "@/components/dashboard/shifts/need-card";
import type { SchedulePerson } from "@/components/dashboard/shifts/schedule-form";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { mayHearCall } from "@/server/shift-access";

import type { CircleNames } from "./names";
import type { Need } from "./shift-views";
import type { ShiftCopy } from "./shift-words";

/** The cards the viewer is asked to answer, every word in their language and every time and name from the record. */
export function needItems(circle: CircleSnapshot, needs: readonly Need[], copy: ShiftCopy, format: Formatters, names: CircleNames): NeedItem[] {
  return needs.map(({ shift, kind, part }) => {
    const name = names.member(shift.memberId);
    const when = fill(copy.when, { day: format.weekdayDay(shift.startsAt), start: format.time(shift.startsAt), end: format.time(shift.endsAt) });
    const base = {
      shiftId: shift.id,
      kind,
      when,
      name,
      wallet: circle.shiftRules.find((rules) => rules.payeeId === shift.payeeId)?.payoutWallet ?? ("paypal" as const),
      toYou: shift.memberId === circle.viewer.memberId,
    };
    if (kind === "word") {
      const time = shift.checkedInAt === null ? "" : format.time(shift.checkedInAt);
      return { ...base, headline: fill(copy.needs.questions[part], { name }), hint: fill(copy.needs.wordHint, { name, time }), buttonLabel: fill(copy.needs.answers[part], { name }), callSim: mayHearCall(circle, shift) };
    }
    return kind === "check_in"
      ? { ...base, headline: copy.needs.checkInTitle, hint: copy.needs.checkInHint, buttonLabel: copy.needs.checkIn }
      : { ...base, headline: copy.needs.checkOutTitle, hint: copy.needs.checkOutHint, buttonLabel: copy.needs.checkOut };
  });
}

/** Who can take each kind of shift: an aide shift a caregiver with a rate, any other a member who is not an observer. */
export function schedulePeople(circle: CircleSnapshot): Record<ShiftKind, SchedulePerson[]> {
  const rated = new Set(circle.payees.filter((payee) => payee.caregiverRateCentsPerHour !== null).flatMap((payee) => (payee.payee.member ? [payee.payee.member.memberId] : [])));
  const active = circle.members.filter((member) => member.status === "active");
  const person = (member: (typeof active)[number]): SchedulePerson => ({ id: member.id, name: member.displayName });
  const aides = active.filter((member) => member.role === "caregiver" && rated.has(member.id)).map(person);
  const others = active.filter((member) => member.role !== "observer").map(person);
  return { aide: aides, visit: others, appointment: others, drive: others };
}
