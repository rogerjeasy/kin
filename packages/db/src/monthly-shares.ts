import { calendarDay, monthlyShareMayMove, type MonthlyShareState, type Money } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";

import type { MonthlyShareRecord } from "./circle-snapshot.ts";
import type { Transaction } from "./connection.ts";
import { recordContribution, type ContributionOutcome } from "./contributions.ts";
import { circles, monthlyShares } from "./schema/index.ts";

export type MonthlyShareReason = "refused" | "invalid" | "running" | "move";

export class MonthlyShareError extends Error {
  readonly retryable = false;
  readonly reason: MonthlyShareReason;

  constructor(reason: MonthlyShareReason) {
    super(`Monthly share refused: ${reason}`);
    this.name = "MonthlyShareError";
    this.reason = reason;
  }
}

const REASONS: Readonly<Record<string, MonthlyShareReason>> = {
  "42501": "refused",
  "23514": "invalid",
  "22P02": "invalid",
  KB010: "running",
  KB011: "move",
};

/**
 * Records the signed-in member's own new share. `paypalSubscriptionId` and
 * `approvalUrl` are the subscription Kin just made at PayPal; both are `null`
 * in a demo circle, whose share is simulated and runs at once. Run as the
 * person: the database rechecks their seat, the circle and the amount.
 */
export async function startMonthlyShare(
  tx: Transaction,
  input: { readonly circleId: string; readonly id: string; readonly cents: number; readonly paypalSubscriptionId: string | null; readonly approvalUrl: string | null },
): Promise<string> {
  return refusals(async () => {
    const result = await tx.execute<{ id: string }>(
      sql`select kin_private.start_my_share(${input.circleId}::uuid, ${input.id}::uuid, ${input.cents}::bigint, ${input.paypalSubscriptionId}, ${input.approvalUrl}) as id`,
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error("The database made no monthly share");
    return id;
  });
}

/** Pauses, resumes or cancels the member's own share, once PayPal has. Run as the person. */
export async function moveMonthlyShare(tx: Transaction, input: { readonly circleId: string; readonly shareId: string; readonly state: Exclude<MonthlyShareState, "approval_pending"> }): Promise<void> {
  await refusals(() => tx.execute(sql`select kin_private.move_my_share(${input.circleId}::uuid, ${input.shareId}::uuid, ${input.state}::public.monthly_share_state)`));
}

async function refusals<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[sqlState(error) ?? ""];
    if (reason !== undefined) throw new MonthlyShareError(reason);
    throw error;
  }
}

function sqlState(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? sqlState(error.cause) : null;
}

/** A share as the worker reads it: enough to record its charges and follow PayPal. */
export type ShareRow = Pick<MonthlyShareRecord, "id" | "memberId" | "state" | "simulated" | "paypalSubscriptionId" | "createdAt"> & { readonly amount: Money };

export type ShareKey = { readonly id: string } | { readonly paypalSubscriptionId: string };

/** One circle's share by Kin's ID or PayPal's. Run inside `asService` for the circle. */
export async function readShare(tx: Transaction, circleId: string, key: ShareKey): Promise<ShareRow | null> {
  const match = "id" in key ? eq(monthlyShares.id, key.id) : eq(monthlyShares.paypalSubscriptionId, key.paypalSubscriptionId);
  const [row] = await tx.select().from(monthlyShares).where(and(eq(monthlyShares.circleId, circleId), match));
  if (!row) return null;
  return {
    id: row.id,
    memberId: row.memberId,
    state: row.state,
    simulated: row.simulated,
    paypalSubscriptionId: row.paypalSubscriptionId,
    createdAt: row.createdAt,
    amount: { cents: row.amountCents, currency: row.currency },
  };
}

/**
 * Brings a share in line with what PayPal says: its state, as far as the
 * diagram allows (news that would move it backwards is ignored, never an
 * error), how many charges failed, and when the next one is due. Run inside
 * `asService` for the circle.
 */
export async function followPayPal(
  tx: Transaction,
  circleId: string,
  share: ShareRow,
  seen: { readonly state: MonthlyShareState | null; readonly failedPayments: number; readonly nextBillingAt: Date | null },
): Promise<void> {
  const move = seen.state !== null && seen.state !== share.state && monthlyShareMayMove(share.state, seen.state);
  await tx
    .update(monthlyShares)
    .set({ ...(move && seen.state !== null ? { state: seen.state } : {}), failedPayments: seen.failedPayments, nextBillingAt: seen.nextBillingAt })
    .where(and(eq(monthlyShares.circleId, circleId), eq(monthlyShares.id, share.id)));
}

/** One completed PayPal charge of a share, credited to the member like a top-up (the money core builds the entry). */
export function recordShareCharge(
  tx: Transaction,
  circleId: string,
  share: ShareRow,
  charge: { readonly id: string; readonly gross: Money; readonly fee: Money; readonly paidAt: Date },
): Promise<ContributionOutcome> {
  return recordContribution(tx, circleId, {
    captureId: charge.id,
    memberId: share.memberId,
    gross: charge.gross,
    fee: charge.fee,
    capturedAt: charge.paidAt,
    description: "Monthly share through PayPal",
  });
}

/**
 * A demo circle's month: the share's amount credited to the member, labelled
 * simulated, once for each calendar month of the circle's own clock. There is
 * no PayPal charge behind it and no fee. Run inside `asService` for the circle.
 */
export async function recordSimulatedMonth(tx: Transaction, circleId: string, share: ShareRow): Promise<ContributionOutcome> {
  const [circle] = await tx.select({ timezone: circles.timezone, clockAt: circles.clockAt, demo: circles.demo }).from(circles).where(eq(circles.id, circleId));
  // A simulated charge never lands in a real family's ledger.
  if (!circle?.demo || !share.simulated) throw new MonthlyShareError("refused");
  const now = circle.clockAt ?? new Date();
  const { period } = calendarDay(now, circle.timezone);
  return recordContribution(tx, circleId, {
    captureId: `simulated-share-${share.id}-${period}`,
    memberId: share.memberId,
    gross: share.amount,
    fee: { cents: 0, currency: share.amount.currency },
    capturedAt: now,
    description: "Monthly share (simulated)",
    simulated: true,
  });
}
