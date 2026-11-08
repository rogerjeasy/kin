import { CareValueError, ShiftPriceError, calendarDay, careCreditLogged, isCreditedKind, valueCreditedShift, type ShiftKind } from "@kin/domain";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { readAgreementVersions } from "./agreements.ts";
import type { Transaction } from "./connection.ts";
import { readAccountIds, writeEntries } from "./ledger-store.ts";
import { auditLog, careEntries, circles, ledgerEntries, members, shifts } from "./schema/index.ts";

/** The outbox topic that asks the worker to credit a confirmed visit or drive as care time. */
export const SHIFT_CREDIT_TOPIC = "shift.credit";

/** Why a confirmed visit was left as it is. Each is recorded once in the audit log. */
export type CreditSkipReason = "no_agreement" | "no_care_terms" | "not_valuable";

export type ShiftCreditOutcome = "credited" | "already_credited" | "not_creditable" | CreditSkipReason;

/** The ledger's source ID for a visit's credit: one entry per shift, whoever asks and however often. */
export const shiftCreditSourceId = (shiftId: string): string => `shift-credit-${shiftId}`;

/**
 * Credits a confirmed visit or drive as care time, as Kin's service, inside
 * `asService`: the whole minutes between the two taps, valued at the care
 * rate of the agreement in force on the visit's day. The ledger entry is built
 * by the money core and keyed by the shift, so a message handed out twice, or
 * retried after a crash, writes one entry and one care entry. Whenever the
 * agreement does not count care time, or anything looks wrong, the shift stays
 * confirmed and the reason is recorded once; no amount is ever guessed.
 */
export async function creditShift(tx: Transaction, circleId: string, shiftId: string): Promise<ShiftCreditOutcome> {
  const [row] = await tx
    .select({
      kind: shifts.kind,
      title: shifts.title,
      state: shifts.state,
      memberId: shifts.memberId,
      checkedInAt: shifts.checkedInAt,
      checkedOutAt: shifts.checkedOutAt,
      role: members.role,
      currency: circles.currency,
      demo: circles.demo,
      timezone: circles.timezone,
    })
    .from(shifts)
    .innerJoin(circles, eq(circles.id, shifts.circleId))
    .innerJoin(members, and(eq(members.circleId, shifts.circleId), eq(members.id, shifts.memberId)))
    .where(and(eq(shifts.circleId, circleId), eq(shifts.id, shiftId)))
    .for("update", { of: shifts });
  if (!row) return "not_creditable";
  if (row.state === "credited") return "already_credited";
  // Safe: a check constraint holds the kind to the domain's own list.
  if (row.state !== "confirmed" || !isCreditedKind(row.kind as ShiftKind, row.role) || row.checkedInAt === null || row.checkedOutAt === null) return "not_creditable";

  const day = calendarDay(row.checkedInAt, row.timezone);
  const { versions } = await readAgreementVersions(tx, circleId, day.occurredOn);
  const agreement = versions.find((version) => version.status === "in_force");
  if (!agreement) return skip(tx, circleId, shiftId, "no_agreement");
  if (!agreement.care) return skip(tx, circleId, shiftId, "no_care_terms");

  let credit;
  try {
    credit = valueCreditedShift(row.checkedInAt, row.checkedOutAt, agreement.care.rateCentsPerHour);
  } catch (error) {
    if (error instanceof ShiftPriceError || error instanceof CareValueError) return skip(tx, circleId, shiftId, "not_valuable");
    throw error;
  }
  if (credit.cents <= 0) return skip(tx, circleId, shiftId, "not_valuable");

  const sourceId = shiftCreditSourceId(shiftId);
  const entry = careCreditLogged(
    {
      id: randomUUID(),
      circleId,
      ...day,
      source: { type: "approval", id: sourceId },
      currency: row.currency,
      simulated: row.demo,
      description: `Care ${row.kind} credited${row.demo ? " (simulated)" : ""}`,
    },
    { memberId: row.memberId, minutes: credit.minutes, rateCentsPerHour: agreement.care.rateCentsPerHour },
  );
  // A repeat after a crash finds the entry the first try wrote, and links it.
  const [written] = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.circleId, circleId), eq(ledgerEntries.sourceType, "approval"), eq(ledgerEntries.sourceId, sourceId)));
  const entryId = written?.id ?? entry.id;
  if (!written) await writeEntries(tx, [entry], await readAccountIds(tx, circleId));
  await tx.insert(careEntries).values({
    id: randomUUID(),
    circleId,
    memberId: row.memberId,
    occurredOn: day.occurredOn,
    minutes: credit.minutes,
    note: row.title,
    approved: true,
    ledgerEntryId: entryId,
    shiftId,
  });
  await tx.update(shifts).set({ state: "credited" }).where(and(eq(shifts.circleId, circleId), eq(shifts.id, shiftId), eq(shifts.state, "confirmed")));
  await tx.insert(auditLog).values({
    id: randomUUID(),
    circleId,
    actor: "service",
    action: "shift.credited",
    subjectType: "shift",
    subjectId: shiftId,
    details: { entryId, minutes: credit.minutes, cents: credit.cents, simulated: row.demo },
    origin: "worker",
  });
  return "credited";
}

/** Leaves the shift confirmed and says why, once, however many times the message comes. */
async function skip(tx: Transaction, circleId: string, shiftId: string, reason: CreditSkipReason): Promise<CreditSkipReason> {
  const [already] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.circleId, circleId), eq(auditLog.action, "shift.credit_skipped"), eq(auditLog.subjectId, shiftId)));
  if (!already) {
    await tx.insert(auditLog).values({ id: randomUUID(), circleId, actor: "service", action: "shift.credit_skipped", subjectType: "shift", subjectId: shiftId, details: { reason }, origin: "worker" });
  }
  return reason;
}
