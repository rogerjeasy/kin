import { calendarDay, contributionReceived, type Money } from "@kin/domain";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Transaction } from "./connection.ts";
import { readAccountIds, writeEntries } from "./ledger-store.ts";
import { circles, ledgerEntries, members } from "./schema/index.ts";

/** A capture PayPal has confirmed, read back from PayPal itself. */
export type ConfirmedCapture = {
  readonly captureId: string;
  readonly memberId: string;
  readonly gross: Money;
  readonly fee: Money;
  readonly capturedAt: Date;
};

export type ContributionOutcome = "recorded" | "already_recorded";

/** The capture cannot be written to this circle's ledger. A person must look. */
export class ContributionMismatchError extends Error {
  readonly retryable = false;

  constructor(reason: "no_circle" | "no_member" | "currency") {
    super(`PayPal capture cannot be recorded: ${reason}`);
    this.name = "ContributionMismatchError";
  }
}

/**
 * Credits a member with a top-up PayPal confirmed: the money core builds the
 * entry (gross to the member, PayPal's fee shared), and the capture's ID is
 * the entry's source, so the webhook and the direct read of the same capture
 * write it once between them. Run inside `asService` for the circle.
 */
export async function recordContribution(tx: Transaction, circleId: string, capture: ConfirmedCapture): Promise<ContributionOutcome> {
  if (await contributionRecorded(tx, circleId, capture.captureId)) return "already_recorded";
  const [circle] = await tx.select({ timezone: circles.timezone, currency: circles.currency }).from(circles).where(eq(circles.id, circleId));
  if (!circle) throw new ContributionMismatchError("no_circle");
  const [member] = await tx.select({ id: members.id }).from(members).where(and(eq(members.circleId, circleId), eq(members.id, capture.memberId)));
  if (!member) throw new ContributionMismatchError("no_member");
  if (capture.gross.currency !== circle.currency || capture.fee.currency !== circle.currency) throw new ContributionMismatchError("currency");

  const entry = contributionReceived(
    {
      id: randomUUID(),
      circleId,
      ...calendarDay(capture.capturedAt, circle.timezone),
      description: "Top-up through PayPal",
      source: { type: "paypal_event", id: capture.captureId },
      currency: circle.currency,
      // A real PayPal sandbox transaction stands behind it, even in a demo circle.
      simulated: false,
    },
    { memberId: capture.memberId, grossCents: capture.gross.cents, feeCents: capture.fee.cents },
  );
  await writeEntries(tx, [entry], await readAccountIds(tx, circleId));
  return "recorded";
}

/** Whether the ledger already holds the top-up of this PayPal capture. */
export async function contributionRecorded(tx: Transaction, circleId: string, captureId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.circleId, circleId), eq(ledgerEntries.sourceType, "paypal_event"), eq(ledgerEntries.sourceId, captureId)));
  return row !== undefined;
}
