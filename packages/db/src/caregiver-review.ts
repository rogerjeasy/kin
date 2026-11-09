import { CareAgreementGateError, CaregiverPayoutError, calendarDay, parseCaregiverBillDetails, planCaregiverPayout, type CircleRole, type ParentLevel } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";

import { readAgreementVersions } from "./agreements.ts";
import { assertCaregiverWorkCovered } from "./care-agreements.ts";

import { CaregiverBillingError, operation, requiredId } from "./caregiver-billing.ts";
import type { Transaction } from "./connection.ts";
import { bills, circles, members, payees } from "./schema/index.ts";

type Review = { readonly circleId: string; readonly billId: string; readonly now: Date };

/**
 * Sends a caregiver's bill for the family's approval, raising its proposal.
 * Run as the person, inside `asPerson`: what is read here is what their role
 * may see, the approval engine plans from it, and the database operation
 * refuses a plan that does not match the agreement in force.
 */
export async function sendCaregiverBill(tx: Transaction, review: Review): Promise<string> {
  const plan = await planFor(tx, review);
  return operation(async () => {
    const result = await tx.execute<{ id: string }>(
      sql`select kin_private.send_caregiver_bill(${review.circleId}::uuid, ${review.billId}::uuid, ${JSON.stringify(plan)}::jsonb) as id`,
    );
    return requiredId(result.rows[0]?.id);
  });
}

/** Declines a caregiver's bill as received, which frees its service days for a corrected bill. */
export async function declineCaregiverBill(tx: Transaction, review: Omit<Review, "now">): Promise<void> {
  await operation(() => tx.execute(sql`select kin_private.decline_caregiver_bill(${review.circleId}::uuid, ${review.billId}::uuid)`));
}

async function planFor(tx: Transaction, { circleId, billId, now }: Review) {
  const [bill] = await tx.select().from(bills).where(and(eq(bills.circleId, circleId), eq(bills.id, billId)));
  if (!bill || bill.caregiverDetails === null) throw new CaregiverBillingError("refused");
  const [payee] = await tx
    .select({ status: payees.status, memberId: payees.memberId, role: members.role })
    .from(payees)
    .leftJoin(members, and(eq(members.circleId, payees.circleId), eq(members.id, payees.memberId)))
    .where(and(eq(payees.circleId, circleId), eq(payees.id, bill.payeeId)));
  const [circle] = await tx.select({ pausedUntil: circles.pausedUntil, timezone: circles.timezone }).from(circles).where(eq(circles.id, circleId));
  if (!payee || !circle) throw new CaregiverBillingError("refused");
  // Planned against the version in force, never one still waiting for acceptance.
  const { versions } = await readAgreementVersions(tx, circleId, calendarDay(now, circle.timezone).occurredOn);
  const agreement = versions.find((version) => version.status === "in_force");
  // No agreement can mean none exists or that this person may not read it:
  // the database operation tells the two apart, so it is asked.
  if (!agreement) return refusal(tx, circleId, billId);
  // Once the caregiver has a care agreement on file, a bill is sent only for days it covers, at the rate it states.
  const details = parseCaregiverBillDetails(bill.caregiverDetails);
  try {
    await assertCaregiverWorkCovered(tx, { circleId, payeeId: bill.payeeId, workDates: details.visits.map((visit) => visit.date), rateCentsPerHour: details.rateCentsPerHour });
  } catch (error) {
    if (error instanceof CareAgreementGateError) throw new CaregiverBillingError("care_agreement");
    throw error;
  }
  const member = payee.memberId !== null && payee.role !== null ? { memberId: payee.memberId, role: payee.role satisfies CircleRole } : null;
  try {
    const { plan } = planCaregiverPayout({
      details: bill.caregiverDetails,
      billCents: bill.amountCents,
      // A caregiver's bill is never paid on a standing rule, whatever the payee's.
      payee: { status: payee.status, member, autoPay: null },
      agreement: {
        version: agreement.version,
        approvals: agreement.approvals,
      },
      parentLevel: await parentLevel(tx, circleId),
      pausedUntil: circle.pausedUntil,
      now,
    });
    if (plan.outcome === "paused") throw new CaregiverBillingError("paused");
    if (plan.outcome === "refused") throw new CaregiverBillingError("above_ceiling");
    return plan;
  } catch (error) {
    if (error instanceof CaregiverPayoutError) throw new CaregiverBillingError("refused");
    throw error;
  }
}

async function refusal(tx: Transaction, circleId: string, billId: string): Promise<never> {
  await operation(() => tx.execute(sql`select kin_private.send_caregiver_bill(${circleId}::uuid, ${billId}::uuid, 'null'::jsonb)`));
  throw new CaregiverBillingError("no_agreement");
}

// The database asks the same question: does any active parent decide?
async function parentLevel(tx: Transaction, circleId: string): Promise<ParentLevel> {
  const parents = await tx
    .select({ level: members.parentLevel })
    .from(members)
    .where(and(eq(members.circleId, circleId), eq(members.role, "parent"), eq(members.status, "active")));
  return parents.some((parent) => parent.level === "decides") ? "decides" : "informed";
}
