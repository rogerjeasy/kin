import type { AgreementTerms, ShiftKind } from "@kin/domain";
import { randomUUID } from "node:crypto";

import { acceptAgreement, proposeAgreement } from "../agreements.ts";
import { takeDemoSeat } from "../people.ts";
import { asPerson } from "../scope.ts";
import { checkInShift, checkOutShift, confirmShift, scheduleShift } from "../shifts.ts";
import type { VisitorCircle } from "./circles.ts";
import type { TestDatabases } from "./databases.ts";
import { CLOCK } from "./shifts.ts";
import { seatPerson } from "./circles.ts";

export type ConfirmedVisit = { readonly shiftId: string; readonly memberUserId: string; readonly minutes: number };

/**
 * A visit or drive that both keys have turned, in a demo circle, as the family
 * does it: the member's own check-in and check-out, then the organizer's word.
 * The demo clock stands still, so the check-in is stamped at the clock and the
 * check-out at the planned end: the visit lasts from 18:00 to `endsAt`.
 */
export async function confirmedVisit(
  db: TestDatabases,
  circle: VisitorCircle,
  change: { kind?: Extract<ShiftKind, "visit" | "drive">; member?: "ana" | "marcus" | "rose"; endsAt?: string } = {},
): Promise<ConfirmedVisit> {
  const circleId = circle.circleId;
  const shiftId = randomUUID();
  const member = circle.members[change.member ?? "ana"];
  const memberUserId = await seatPerson(db, circleId, member);
  const endsAt = new Date(change.endsAt ?? "2026-10-30T18:45:00Z");
  await asPerson(db.app, circle.userId, (tx) =>
    scheduleShift(tx, { circleId, id: shiftId, kind: change.kind ?? "visit", memberId: member, title: null, startsAt: new Date("2026-10-30T17:30:00Z"), endsAt }),
  );
  await asPerson(db.app, memberUserId, (tx) => checkInShift(tx, { circleId, shiftId }));
  await asPerson(db.app, memberUserId, (tx) => checkOutShift(tx, { circleId, shiftId, now: CLOCK }));
  await asPerson(db.app, circle.userId, (tx) => confirmShift(tx, { circleId, shiftId, now: CLOCK }));
  return { shiftId, memberUserId, minutes: Math.floor((endsAt.getTime() - CLOCK.getTime()) / 60_000) };
}

/** Version 2 of the agreement counts no care time, proposed by the organizer and accepted by the others who share the cost, in force on the demo's day. */
export async function agreeWithoutCare(db: TestDatabases, circle: VisitorCircle): Promise<void> {
  const terms: AgreementTerms = {
    shares: [{ memberId: circle.members.marcus, bps: 4500 }, { memberId: circle.members.elena, bps: 3000 }, { memberId: circle.members.ana, bps: 2500 }],
    care: null,
    approvals: { ceilingCents: 300_000, secondApprovalAboveCents: 40_000, parentDecidesAboveCents: 5_000 },
    effectiveOn: "2026-10-30",
  };
  const id = await asPerson(db.app, circle.userId, (tx) => proposeAgreement(tx, { circleId: circle.circleId, terms }));
  for (const persona of ["marcus", "ana"] as const) {
    await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members[persona]));
    await asPerson(db.app, circle.userId, (tx) => acceptAgreement(tx, { circleId: circle.circleId, agreementId: id }));
  }
  await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members.elena));
}
