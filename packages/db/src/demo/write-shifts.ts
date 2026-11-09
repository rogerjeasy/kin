import { calendarDay, type ShiftPermissionTerms } from "@kin/domain";
import { randomUUID } from "node:crypto";

import type { Transaction } from "../connection.ts";
import { shiftPermissionDigest } from "../shift-permissions.ts";
import { shiftPermissions, shifts } from "../schema/index.ts";
import type { DemoTime } from "./demo-time.ts";
import { ROSES_CIRCLE, type PayeeKey, type PersonaKey } from "./roses-circle.ts";
import { SCHEDULED_SHIFTS, SHIFT_PERMISSION } from "./roses-shifts.ts";
import { todaysShiftWindow } from "./shift-window.ts";

type Rows = {
  readonly circleId: string;
  readonly members: Readonly<Record<PersonaKey, string>>;
  readonly payees: Readonly<Record<PayeeKey, string>>;
  readonly time: DemoTime;
};

/**
 * Rose's standing permission for Amara's shifts and the calendar ahead. No
 * shift is paid under it yet: a paid shift carries a payment, and every payment
 * is in the ledger, which is the money core's own example and holds none. The
 * first shift paid under it is the one the visitor confirms.
 */
export async function writeShifts(tx: Transaction, rows: Rows): Promise<void> {
  const { circleId, members, payees, time } = rows;
  const terms: ShiftPermissionTerms = {
    payeeId: payees.amara,
    maxMinutesPerDay: SHIFT_PERMISSION.maxMinutesPerDay,
    perShiftCents: SHIFT_PERMISSION.perShiftCents,
    validFrom: time.day(SHIFT_PERMISSION.validFrom),
    expiresOn: time.day(SHIFT_PERMISSION.expiresOn),
  };
  const permissionId = randomUUID();
  await tx.insert(shiftPermissions).values({
    id: permissionId,
    circleId,
    ...terms,
    grantedBy: members.rose,
    recordedBy: members.rose,
    status: "active",
    spokenText: SHIFT_PERMISSION.spokenText,
    evidenceRef: "demo-call",
    simulated: true,
    digest: shiftPermissionDigest(terms),
    grantedAt: time.at(SHIFT_PERMISSION.grantedAt),
  });

  const templateToday = calendarDay(ROSES_CIRCLE.clockAt, ROSES_CIRCLE.timezone).occurredOn;
  await tx.insert(shifts).values(
    SCHEDULED_SHIFTS.map((shift) => {
      const mapped = { startsAt: time.at(shift.startsAt), endsAt: time.at(shift.endsAt) };
      // Today's shift is kept on the clock's own day: see todaysShiftWindow.
      const window = calendarDay(shift.startsAt, ROSES_CIRCLE.timezone).occurredOn === templateToday ? todaysShiftWindow(mapped, time.now, ROSES_CIRCLE.timezone) : mapped;
      return {
        id: randomUUID(),
        circleId,
        kind: shift.kind,
        title: shift.title,
        memberId: members[shift.member],
        payeeId: shift.kind === "aide" ? payees.amara : null,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        createdBy: members.elena,
      };
    }),
  );
}
