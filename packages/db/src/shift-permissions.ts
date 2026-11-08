import { ShiftPermissionTermsError, calendarDay, checkShiftPermissionTerms, type MandateStatus, type ShiftPermissionTerms } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import { readAgreementVersions } from "./agreements.ts";
import type { ShiftPermissionRecord } from "./circle-snapshot.ts";
import type { Transaction } from "./connection.ts";
import { ShiftError, shiftOperation } from "./shift-errors.ts";
import { circles, proposals, shiftPermissionUses, shiftPermissions } from "./schema/index.ts";

/** What counts toward a permission's daily hours: a payment still waiting, under way or done. */
export const COUNTED_PROPOSAL_STATES = ["pending_approval", "approved", "executing", "settled"] as const;

/**
 * Records the parent's standing permission to pay a caregiver's confirmed
 * shifts. The terms are checked by plain code in `packages/domain` against the
 * agreement's ceiling, and the database asserts the same again, seals the
 * terms with a digest and records who recorded it. A retry with the same `id`
 * grants it once. Run as the person, inside `asPerson`.
 */
export async function grantShiftPermission(
  tx: Transaction,
  input: { readonly circleId: string; readonly id: string; readonly terms: ShiftPermissionTerms; readonly spokenText: string | null; readonly now: Date },
): Promise<string> {
  const { circleId, id, terms, spokenText, now } = input;
  const [circle] = await tx.select({ timezone: circles.timezone }).from(circles).where(eq(circles.id, circleId));
  if (!circle) throw new ShiftError("refused");
  const { versions } = await readAgreementVersions(tx, circleId, calendarDay(now, circle.timezone).occurredOn);
  const agreement = versions.find((version) => version.status === "in_force");
  // No agreement can mean none exists or that this person may not read it: the database tells the two apart.
  try {
    if (agreement) checkShiftPermissionTerms(terms, agreement.approvals.ceilingCents);
  } catch (error) {
    if (error instanceof ShiftPermissionTermsError) throw new ShiftError(error.reason);
    throw error;
  }
  await shiftOperation(() =>
    tx.execute(sql`select kin_private.grant_shift_permission(
      ${circleId}::uuid, ${id}::uuid, ${terms.payeeId}::uuid, ${terms.maxMinutesPerDay}::integer, ${terms.perShiftCents}::bigint,
      ${terms.validFrom}::date, ${terms.expiresOn}::date, ${spokenText})`),
  );
  return id;
}

/** Pauses, resumes or ends a permission. The database decides who may, and refuses a move its diagram does not draw. */
export async function setShiftPermissionStatus(tx: Transaction, input: { readonly circleId: string; readonly permissionId: string; readonly status: MandateStatus }): Promise<void> {
  await shiftOperation(() => tx.execute(sql`select kin_private.set_shift_permission_status(${input.circleId}::uuid, ${input.permissionId}::uuid, ${input.status}::mandate_status)`));
}

/**
 * The seal of a permission's terms: SHA-256 of the text PostgreSQL makes of
 * `jsonb_build_array(...)` for them, which is what the database stores when it
 * grants one. A seeded permission is sealed the same way, so every digest checks alike.
 */
export function shiftPermissionDigest(terms: ShiftPermissionTerms): string {
  const parts = [terms.payeeId, terms.maxMinutesPerDay, terms.perShiftCents, terms.validFrom, terms.expiresOn].map((part) => JSON.stringify(part));
  return createHash("sha256").update("[" + parts.join(", ") + "]", "utf8").digest("hex");
}

/** The circle's shift permissions with the minutes each has used today, as the person looking may see them. */
export async function readShiftPermissionRecords(tx: Transaction, circleId: string, now: Date, timezone: string): Promise<ShiftPermissionRecord[]> {
  const rows = await tx.select().from(shiftPermissions).where(eq(shiftPermissions.circleId, circleId)).orderBy(shiftPermissions.createdAt, shiftPermissions.id);
  const uses = await tx
    .select({
      permissionId: shiftPermissionUses.permissionId,
      shiftId: shiftPermissionUses.shiftId,
      proposalId: shiftPermissionUses.proposalId,
      cents: shiftPermissionUses.cents,
      minutes: shiftPermissionUses.minutes,
      day: shiftPermissionUses.day,
      createdAt: shiftPermissionUses.createdAt,
      state: proposals.state,
    })
    .from(shiftPermissionUses)
    .innerJoin(proposals, and(eq(proposals.circleId, shiftPermissionUses.circleId), eq(proposals.id, shiftPermissionUses.proposalId)))
    .where(eq(shiftPermissionUses.circleId, circleId))
    .orderBy(shiftPermissionUses.createdAt, shiftPermissionUses.id);
  const today = calendarDay(now, timezone).occurredOn;
  return rows.map((row) => {
    const own = uses.filter((use) => use.permissionId === row.id);
    const counted = own.filter((use) => use.day === today && (COUNTED_PROPOSAL_STATES as readonly string[]).includes(use.state));
    return {
      id: row.id,
      payeeId: row.payeeId,
      grantedBy: row.grantedBy,
      recordedBy: row.recordedBy,
      maxMinutesPerDay: row.maxMinutesPerDay,
      perShiftCents: row.perShiftCents,
      validFrom: row.validFrom,
      expiresOn: row.expiresOn,
      status: row.status,
      spokenText: row.spokenText,
      simulated: row.simulated,
      digest: row.digest,
      grantedAt: row.grantedAt,
      endedAt: row.endedAt,
      usedMinutesToday: counted.reduce((sum, use) => sum + use.minutes, 0),
      uses: own.map((use) => ({ shiftId: use.shiftId, proposalId: use.proposalId, cents: use.cents, minutes: use.minutes, day: use.day, at: use.createdAt, state: use.state })),
    };
  });
}
