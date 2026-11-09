import { calendarDay, planApprovals, type ParentLevel } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";

import { readAgreementVersions } from "./agreements.ts";
import type { Transaction } from "./connection.ts";
import { PresenceError, requestHelpPayout } from "./presence.ts";
import { circles, members } from "./schema/index.ts";

export type ProposeHelpInput = {
  readonly circleId: string;
  readonly checkId: string;
  readonly cents: number;
  /** The family's words beside the payment, from `presenceHelpNote`. */
  readonly note: string;
  readonly now: Date;
};

/**
 * Puts help for a person who said "yes, it was me" to the family for approval. The money core's approval engine makes
 * the plan (who must say yes, as for any payment to a new payee) from the agreement in force and the circle's own
 * ledger of roles; the database checks that plan against the agreement again, and refuses help unless the person
 * confirmed it was them and a PayPal account, and for more than the caller asked for. The payee is made from that
 * account alone. Run as the person, inside `asPerson`. Returns the proposal's ID.
 */
export async function proposeHelp(tx: Transaction, input: ProposeHelpInput): Promise<string> {
  const { circleId, now } = input;
  if (!Number.isSafeInteger(input.cents) || input.cents <= 0) throw new PresenceError("invalid");
  const [circle] = await tx.select({ pausedUntil: circles.pausedUntil, timezone: circles.timezone }).from(circles).where(eq(circles.id, circleId));
  if (!circle) throw new PresenceError("refused");
  // Only those who may act on the circle's money can read its agreement, so the role is asked first: anyone else is refused, not told the circle has none.
  const [me] = await tx.select({ role: members.role }).from(members).where(and(eq(members.circleId, circleId), eq(members.userId, sql`current_setting('kin.user_id', true)`), eq(members.status, "active")));
  if (!me || (me.role !== "organizer" && me.role !== "contributor" && me.role !== "parent")) throw new PresenceError("refused");
  const { versions } = await readAgreementVersions(tx, circleId, calendarDay(now, circle.timezone).occurredOn);
  const agreement = versions.find((version) => version.status === "in_force");
  if (!agreement) throw new PresenceError("no_agreement");
  const roster = await tx.select({ role: members.role, level: members.parentLevel }).from(members).where(and(eq(members.circleId, circleId), eq(members.status, "active")));
  const parentLevel: ParentLevel = roster.some((member) => member.role === "parent" && member.level === "decides") ? "decides" : "informed";
  const plan = planApprovals({
    kind: "caregiver_payout",
    cents: input.cents,
    // A person helped for the first time is a new payee: the whole circle is told, and a new payee never pays on a standing rule.
    payee: { status: "new", member: null, autoPay: null },
    agreement,
    parentLevel,
    pausedUntil: circle.pausedUntil,
    now,
  });
  if (plan.outcome === "paused") throw new PresenceError("paused");
  if (plan.outcome === "refused") throw new PresenceError("above_ceiling");
  if (plan.outcome !== "needs_approval") throw new PresenceError("refused");
  return requestHelpPayout(tx, { circleId, checkId: input.checkId, cents: input.cents, note: input.note, plan });
}
