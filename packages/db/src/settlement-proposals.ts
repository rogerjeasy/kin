import { calendarDay, planSettlementPayouts, settlePeriod, type CircleRole, type ParentLevel } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";

import { readAgreementVersions } from "./agreements.ts";
import { CaregiverBillingError, operation, postgresError, requiredId } from "./caregiver-billing.ts";
import type { Transaction } from "./connection.ts";
import { readLedger } from "./ledger-store.ts";
import { circles, members } from "./schema/index.ts";

type Proposal = {
  readonly circleId: string;
  /** The period to close, as YYYY-MM. */
  readonly period: string;
  readonly now: Date;
  /** The most PayPal charges to send a payout of this many cents, as the worker reserves it. */
  readonly payoutFee: (cents: number) => number;
};

/**
 * Puts a period's settlement to the family. Run as an organizer, inside
 * `asPerson`: the settlement is calculated by the money core from the circle's
 * own ledger and the agreement in force, each payout's approvals are planned by
 * the approval engine, and the database refuses a plan that does not match the
 * agreement or promises more than the pool holds. Returns the settlement's ID.
 * A settlement with nothing to release throws `NothingToSettleError`.
 */
export async function proposeSettlement(tx: Transaction, proposal: Proposal): Promise<string> {
  const { circleId, now } = proposal;
  const [circle] = await tx.select({ pausedUntil: circles.pausedUntil, timezone: circles.timezone, currency: circles.currency }).from(circles).where(eq(circles.id, circleId));
  if (!circle) throw new CaregiverBillingError("refused");
  const { versions } = await readAgreementVersions(tx, circleId, calendarDay(now, circle.timezone).occurredOn);
  const agreement = versions.find((version) => version.status === "in_force");
  if (!agreement) throw new CaregiverBillingError("no_agreement");
  const roster = await tx.select({ id: members.id, role: members.role, level: members.parentLevel }).from(members).where(and(eq(members.circleId, circleId), eq(members.status, "active")));
  const roles = new Map<string, CircleRole>(roster.map((member) => [member.id, member.role]));
  const parentLevel: ParentLevel = roster.some((member) => member.role === "parent" && member.level === "decides") ? "decides" : "informed";
  const ledger = await readLedger(tx, { id: circleId, currency: circle.currency });
  const settlement = settlePeriod({ ledger, agreement, period: proposal.period, payoutFee: proposal.payoutFee });
  const payouts = planSettlementPayouts({ settlement, roles, agreement, parentLevel, pausedUntil: circle.pausedUntil, now });
  if (payouts.length === 0) throw new NothingToSettleError();
  try {
    return await operation(async () => {
      const result = await tx.execute<{ id: string }>(sql`select kin_private.propose_settlement(
        ${circleId}::uuid, ${proposal.period}, ${agreement.version}::integer,
        ${JSON.stringify(settlement.inputs)}::jsonb, ${JSON.stringify(settlement.fairness)}::jsonb, ${JSON.stringify(settlement.plan)}::jsonb,
        ${JSON.stringify(payouts)}::jsonb) as id`);
      return requiredId(result.rows[0]?.id);
    });
  } catch (error) {
    // The database's one answer to a second settlement for a period.
    if (postgresError(error)?.code === PERIOD_SETTLED) throw new SettlementExistsError();
    throw error;
  }
}

const PERIOD_SETTLED = "KB010";

/** The period already has a settlement, put to the family or paid. Retrying cannot help. */
export class SettlementExistsError extends Error {
  readonly retryable = false;

  constructor() {
    super("The period already has a settlement");
    this.name = "SettlementExistsError";
  }
}

/** The period has nobody to pay now: everyone is level, or the pool holds nothing to release. */
export class NothingToSettleError extends Error {
  readonly retryable = false;

  constructor() {
    super("The settlement has nothing to pay out");
    this.name = "NothingToSettleError";
  }
}

/** The person says where their own settlement payout goes. The database checks the address and holds it while a payout waits. */
export async function setOwnSettlementReceiver(tx: Transaction, input: { readonly circleId: string; readonly email: string }): Promise<void> {
  try {
    await operation(() => tx.execute(sql`select kin_private.set_own_settlement_receiver(${input.circleId}::uuid, ${input.email})`));
  } catch (error) {
    if (error instanceof CaregiverBillingError && error.reason === "invalid") throw new CaregiverBillingError("receiver");
    throw error;
  }
}
