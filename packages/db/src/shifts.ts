import type { ShiftKind } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Transaction } from "./connection.ts";
import { ShiftError, shiftOperation, type ShiftReason } from "./shift-errors.ts";
import { settleShift, type ShiftSettled } from "./shift-settlement.ts";
import { auditLog, shifts } from "./schema/index.ts";
import type { PayoutWallet } from "./values.ts";

export { ShiftError } from "./shift-errors.ts";
export type { ShiftReason } from "./shift-errors.ts";
export { settleShift, settleShiftAsService } from "./shift-settlement.ts";
export type { ShiftSettled } from "./shift-settlement.ts";

/** A new ID for a shift, so a retried request schedules it once. */
export const newShiftId = (): string => randomUUID();

/**
 * Puts a shift on the calendar. An organizer, a contributor or the parent may.
 * A retry with the same `id` and the same facts returns the shift already made.
 * Run as the person, inside `asPerson`: the database checks their role and who
 * the shift is for.
 */
export async function scheduleShift(
  tx: Transaction,
  input: {
    readonly circleId: string;
    readonly id: string;
    readonly kind: ShiftKind;
    readonly memberId: string;
    readonly title: string | null;
    readonly startsAt: Date;
    readonly endsAt: Date;
  },
): Promise<string> {
  await shiftOperation(() =>
    tx.execute(sql`select kin_private.schedule_shift(
      ${input.circleId}::uuid, ${input.id}::uuid, ${input.kind}, ${input.memberId}::uuid, ${input.title},
      ${input.startsAt.toISOString()}::timestamptz, ${input.endsAt.toISOString()}::timestamptz)`),
  );
  return input.id;
}

/** The caregiver's own key: they tap in, on the circle's clock. Only the member the shift is for may. Saying it again changes nothing. */
export async function checkInShift(tx: Transaction, input: { readonly circleId: string; readonly shiftId: string }): Promise<void> {
  await shiftOperation(() => tx.execute(sql`select kin_private.check_in_shift(${input.circleId}::uuid, ${input.shiftId}::uuid)`));
}

/** What a turn of a key brought about: the payment, if both keys have now turned and it could be raised. */
export type ShiftTurn = {
  /** The payment this turn raised, or `null` when a key is still missing, the shift is not paid, or the payment is held. */
  readonly settled: ShiftSettled | null;
  /** Why a shift with both keys turned is not yet settled (a paused circle, no agreement...); it can be settled again later. */
  readonly held: ShiftReason | null;
};

/** Reasons for which a confirmed shift stays confirmed and waits, instead of undoing the key that was just turned. */
export const SHIFT_HOLD_REASONS: readonly ShiftReason[] = ["paused", "no_agreement", "above_ceiling", "missing_rate", "not_covered", "visit_too_short", "visit_too_long", "invalid"];

/** Settles the shift if both its keys have turned. A failure to settle holds the shift, in a savepoint, and never undoes the key. */
async function settleIfReady(tx: Transaction, circleId: string, shiftId: string, now: Date): Promise<ShiftTurn> {
  const [shift] = await tx.select({ state: shifts.state, kind: shifts.kind, proposalId: shifts.proposalId }).from(shifts).where(and(eq(shifts.circleId, circleId), eq(shifts.id, shiftId)));
  if (!shift || shift.state !== "confirmed" || shift.kind !== "aide" || shift.proposalId !== null) return { settled: null, held: null };
  try {
    return { settled: await tx.transaction((inner) => settleShift(inner, { circleId, shiftId, now })), held: null };
  } catch (error) {
    if (error instanceof ShiftError && SHIFT_HOLD_REASONS.includes(error.reason)) return { settled: null, held: error.reason };
    throw error;
  }
}

/**
 * The end of the caregiver's key. If the family's word is already in, the
 * shift is confirmed and, for an aide, settled in this same call; otherwise it
 * waits for the word. Only the member the shift is for may.
 */
export async function checkOutShift(tx: Transaction, input: { readonly circleId: string; readonly shiftId: string; readonly now: Date }): Promise<ShiftTurn> {
  await shiftOperation(() => tx.execute(sql`select kin_private.check_out_shift(${input.circleId}::uuid, ${input.shiftId}::uuid)`));
  return settleIfReady(tx, input.circleId, input.shiftId, input.now);
}

/**
 * The family's key. The parent's word always counts; a sibling's counts only
 * where the parent cannot give it; nobody gives it for their own shift. If the
 * caregiver's key has already turned, an aide's shift is settled in this same call.
 */
export async function confirmShift(tx: Transaction, input: { readonly circleId: string; readonly shiftId: string; readonly now: Date }): Promise<ShiftTurn> {
  await shiftOperation(() => tx.execute(sql`select kin_private.confirm_shift(${input.circleId}::uuid, ${input.shiftId}::uuid)`));
  return settleIfReady(tx, input.circleId, input.shiftId, input.now);
}

/** Calls a shift off before both keys have turned: the member it is for, an organizer or the parent. */
export async function cancelShift(tx: Transaction, input: { readonly circleId: string; readonly shiftId: string }): Promise<void> {
  await shiftOperation(() => tx.execute(sql`select kin_private.cancel_shift(${input.circleId}::uuid, ${input.shiftId}::uuid)`));
}

/** The pay rules a family agreed for one caregiver. Only an organizer sets them, for a caregiver who has a rate. */
export async function setShiftRules(
  tx: Transaction,
  input: { readonly circleId: string; readonly payeeId: string; readonly minimumMinutes: number; readonly overtimeAfterMinutes: number | null; readonly overtimePercent: number },
): Promise<void> {
  await shiftOperation(() =>
    tx.execute(sql`select kin_private.set_shift_rules(
      ${input.circleId}::uuid, ${input.payeeId}::uuid, ${input.minimumMinutes}::integer, ${input.overtimeAfterMinutes}::integer, ${input.overtimePercent}::integer)`),
  );
}

/**
 * Records where the caregiver's own pay goes and into which wallet. Only the
 * caregiver may, for their own payee. A PayPal wallet takes an email; a Venmo
 * wallet an email, a phone number or an @handle. The database refuses to
 * change the target while a payment to them waits for approval or is under way.
 */
export async function setOwnPayoutTarget(tx: Transaction, input: { readonly circleId: string; readonly receiver: string; readonly wallet: PayoutWallet }): Promise<void> {
  try {
    await shiftOperation(() => tx.execute(sql`select kin_private.set_own_payout_target(${input.circleId}::uuid, ${input.receiver}, ${input.wallet})`));
  } catch (error) {
    // The database's only check_violation here is the target itself.
    if (error instanceof ShiftError && error.reason === "invalid") throw new ShiftError("invalid_target");
    throw error;
  }
}

/**
 * PayPal has paid the shift's payout, and the proposal has settled: the shift
 * is paid. Run as Kin's service, inside `asService`, after `confirmPayout`.
 * Does nothing for a payment that is not a shift's, and a repeat changes nothing.
 */
export async function markShiftPaid(tx: Transaction, input: { readonly circleId: string; readonly proposalId: string }): Promise<void> {
  const moved = await tx
    .update(shifts)
    .set({ state: "paid" })
    .where(and(eq(shifts.circleId, input.circleId), eq(shifts.proposalId, input.proposalId), eq(shifts.state, "priced")))
    .returning({ id: shifts.id });
  const [paid] = moved;
  if (paid === undefined) return;
  await tx.insert(auditLog).values({
    id: randomUUID(),
    circleId: input.circleId,
    actor: "service",
    action: "shift.paid",
    subjectType: "shift",
    subjectId: paid.id,
    details: { proposalId: input.proposalId },
    origin: "worker",
  });
}
