import { appendEntry, calendarDay, refundContribution, type ContributionRefund, type RefundHold } from "@kin/domain";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Transaction } from "./connection.ts";
import { ContributionMismatchError } from "./contributions.ts";
import { readAccountIds, readLedger, writeEntries } from "./ledger-store.ts";
import { circles } from "./schema/index.ts";

/** A refund of a top-up PayPal confirmed, read back from PayPal itself. */
export type ConfirmedRefund = ContributionRefund & { readonly refundedAt: Date };

/** `reversed` wrote the reversing entry; `already_reversed` found it there; any other answer is why it waits for a person. */
export type ContributionRefundOutcome = "reversed" | "already_reversed" | RefundHold;

/**
 * Records a refund of a member's top-up as the reversal of its contribution,
 * when the money core says a reversal states it exactly (`refundContribution`).
 * The refund's ID is the reversal's source and the database lets an entry be
 * reversed once, so a refund and a reversal of the same capture, however
 * often PayPal reports them, write one entry between them. Run inside
 * `asService` for the circle.
 */
export async function recordContributionRefund(tx: Transaction, circleId: string, refund: ConfirmedRefund): Promise<ContributionRefundOutcome> {
  const [circle] = await tx.select({ timezone: circles.timezone, currency: circles.currency }).from(circles).where(eq(circles.id, circleId));
  if (!circle) throw new ContributionMismatchError("no_circle");
  const ledger = await readLedger(tx, { id: circleId, currency: circle.currency });
  const decision = refundContribution(ledger, refund, {
    id: randomUUID(),
    ...calendarDay(refund.refundedAt, circle.timezone),
    description: "Top-up refunded through PayPal",
  });
  if (decision.outcome === "held") return decision.reason;
  if (decision.outcome === "already_reversed") return "already_reversed";
  // The money core checks the reversal against the whole ledger once more before it is written.
  appendEntry(ledger, decision.entry);
  await writeEntries(tx, [decision.entry], await readAccountIds(tx, circleId));
  return "reversed";
}
