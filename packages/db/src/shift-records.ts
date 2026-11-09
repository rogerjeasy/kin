import { waitingFor, type ShiftKind } from "@kin/domain";
import { and, asc, eq, isNotNull } from "drizzle-orm";

import type { ParentCallSettingsRecord, ShiftPermissionRecord, ShiftRecord, ShiftRulesRecord } from "./circle-snapshot.ts";
import type { Transaction } from "./connection.ts";
import { readCallStates, readParentCallSettings } from "./shift-call-records.ts";
import { readShiftPermissionRecords } from "./shift-permissions.ts";
import { careEntries, circles, ledgerLines, payees, proposals, shifts } from "./schema/index.ts";

/**
 * The circle's care calendar, standing permissions and caregiver pay rules, as
 * the person looking may see them. Run inside `asPerson`: row-level security
 * gives a caregiver only the shifts they are on and none of the permissions.
 */
export async function readShiftRecords(
  tx: Transaction,
  circleId: string,
  now: Date,
  timezone: string,
): Promise<{ shifts: ShiftRecord[]; shiftPermissions: ShiftPermissionRecord[]; shiftRules: ShiftRulesRecord[]; parentCallSettings: ParentCallSettingsRecord | null }> {
  const [circle] = await tx.select({ demo: circles.demo }).from(circles).where(eq(circles.id, circleId));
  const rows = await tx
    .select({ shift: shifts, proposalState: proposals.state })
    .from(shifts)
    .leftJoin(proposals, and(eq(proposals.circleId, shifts.circleId), eq(proposals.id, shifts.proposalId)))
    .where(eq(shifts.circleId, circleId))
    .orderBy(asc(shifts.startsAt), asc(shifts.id));
  const credits = await readCredits(tx, circleId);
  const callStates = await readCallStates(tx, circleId);
  const rules = await tx
    .select()
    .from(payees)
    .where(and(eq(payees.circleId, circleId), isNotNull(payees.caregiverRateCentsPerHour)))
    .orderBy(asc(payees.createdAt), asc(payees.id));
  return {
    shifts: rows.map(({ shift, proposalState }) => ({
      id: shift.id,
      // Safe: a check constraint holds the kind to the domain's own list.
      kind: shift.kind as ShiftKind,
      title: shift.title,
      memberId: shift.memberId,
      payeeId: shift.payeeId,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      state: shift.state,
      checkedInAt: shift.checkedInAt,
      checkedOutAt: shift.checkedOutAt,
      familyConfirmedAt: shift.familyConfirmedAt,
      familyConfirmedBy: shift.familyConfirmedBy,
      familyConfirmation: shift.familyConfirmation,
      workedMinutes: shift.workedMinutes,
      billableMinutes: shift.billableMinutes,
      cents: shift.cents,
      rateCentsPerHour: shift.rateCentsPerHour,
      proposalId: shift.proposalId,
      proposalState,
      permissionId: shift.permissionId,
      simulated: circle?.demo ?? false,
      // Safe: a check constraint holds the kind to the domain's own list.
      waitingFor: shift.state === "cancelled" ? null : waitingFor({ ...shift, kind: shift.kind as ShiftKind }),
      callState: callStates.get(shift.id) ?? null,
      creditedMinutes: credits.get(shift.id)?.minutes ?? null,
      creditedCents: credits.get(shift.id)?.cents ?? null,
    })),
    shiftPermissions: await readShiftPermissionRecords(tx, circleId, now, timezone),
    parentCallSettings: await readParentCallSettings(tx, circleId),
    shiftRules: rules.map((row) => ({
      payeeId: row.id,
      minimumMinutes: row.shiftMinimumMinutes,
      overtimeAfterMinutes: row.shiftOvertimeAfterMinutes,
      overtimePercent: row.shiftOvertimePercent,
      payoutWallet: row.payoutWallet,
    })),
  };
}

/** What each credited shift counted for: the care entry's minutes and the value of the care-credit entry it points to. */
async function readCredits(tx: Transaction, circleId: string): Promise<Map<string, { minutes: number; cents: number | null }>> {
  const rows = await tx
    .select({ shiftId: careEntries.shiftId, minutes: careEntries.minutes, cents: ledgerLines.cents })
    .from(careEntries)
    // The debit side of a care-credit entry is its value, and the row-level security of the ledger decides who may read it.
    .leftJoin(ledgerLines, and(eq(ledgerLines.circleId, careEntries.circleId), eq(ledgerLines.entryId, careEntries.ledgerEntryId), eq(ledgerLines.direction, "debit")))
    .where(and(eq(careEntries.circleId, circleId), isNotNull(careEntries.shiftId)));
  const credits = new Map<string, { minutes: number; cents: number | null }>();
  for (const row of rows) if (row.shiftId !== null) credits.set(row.shiftId, { minutes: row.minutes, cents: row.cents });
  return credits;
}
