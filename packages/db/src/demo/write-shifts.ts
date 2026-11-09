import { SHIFT_PURPOSE, calendarDay, priceShift, shiftDay, type ShiftPermissionTerms } from "@kin/domain";
import { randomUUID } from "node:crypto";

import type { Transaction } from "../connection.ts";
import { shiftPermissionDigest } from "../shift-permissions.ts";
import { approvals, executions, proposals, shiftPermissionUses, shiftPermissions, shifts } from "../schema/index.ts";
import type { DemoTime } from "./demo-time.ts";
import { ROSES_CIRCLE, type PayeeKey, type PersonaKey } from "./roses-circle.ts";
import { AMARA_PAY, PAID_SHIFTS, SCHEDULED_SHIFTS, SHIFT_PERMISSION } from "./roses-shifts.ts";
import { todaysShiftWindow } from "./shift-window.ts";

type Rows = {
  readonly circleId: string;
  readonly members: Readonly<Record<PersonaKey, string>>;
  readonly payees: Readonly<Record<PayeeKey, string>>;
  readonly time: DemoTime;
};

/**
 * Rose's standing permission for Amara's shifts, the two shifts already paid
 * under it and the calendar ahead. The paid shifts are history the template
 * tells, simulated like the rest of Rose's month: their payments are settled
 * and carry no ledger entry, which keeps the month's money, and so its
 * settlement, as the money core's own example has it.
 */
export async function writeShifts(tx: Transaction, rows: Rows, agreementVersion: number): Promise<void> {
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

  for (const paid of PAID_SHIFTS) {
    const checkedInAt = time.at(paid.checkedInAt);
    const checkedOutAt = time.at(paid.checkedOutAt);
    const price = priceShift(checkedInAt, checkedOutAt, AMARA_PAY);
    const shiftId = randomUUID();
    const proposalId = randomUUID();
    const plan = { outcome: "shift_permission", permissionId, agreementVersion };
    await tx.insert(proposals).values({
      id: proposalId,
      circleId,
      kind: "caregiver_payout",
      cents: price.cents,
      payeeId: payees.amara,
      purpose: SHIFT_PURPOSE,
      raisedBy: null,
      raisedAt: checkedOutAt,
      state: "settled",
      agreementVersion,
      plan,
    });
    await tx.insert(shifts).values({
      id: shiftId,
      circleId,
      kind: paid.kind,
      title: paid.title,
      memberId: members[paid.member],
      payeeId: payees.amara,
      startsAt: time.at(paid.startsAt),
      endsAt: time.at(paid.endsAt),
      state: "paid",
      checkedInAt,
      checkedOutAt,
      familyConfirmedBy: members.rose,
      familyConfirmedAt: checkedOutAt,
      familyConfirmation: "parent",
      workedMinutes: price.workedMinutes,
      billableMinutes: price.billableMinutes,
      rateCentsPerHour: AMARA_PAY.rateCentsPerHour,
      cents: price.cents,
      proposalId,
      permissionId,
      createdBy: members.elena,
    });
    await tx.insert(approvals).values({
      id: randomUUID(),
      circleId,
      proposalId,
      memberId: members.rose,
      role: "parent",
      decision: "approve",
      method: "mandate",
      evidenceRef: `shift_permission:${permissionId}`,
      decidedAt: checkedOutAt,
    });
    await tx.insert(shiftPermissionUses).values({
      id: randomUUID(),
      circleId,
      permissionId,
      shiftId,
      proposalId,
      cents: price.cents,
      minutes: price.billableMinutes,
      day: shiftDay(checkedInAt, ROSES_CIRCLE.timezone),
    });
    await tx.insert(executions).values({
      id: randomUUID(),
      circleId,
      proposalId,
      idempotencyKey: `kin-payout-${proposalId}`,
      state: "confirmed",
      paypalItemId: `simulated-${proposalId}`,
      attempts: 1,
      submittedAt: checkedOutAt,
      confirmedAt: checkedOutAt,
    });
  }

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
