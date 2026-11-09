import { assertWorkCovered, calendarDay, careAgreementStatus, type CareAgreementFacts, type CareAgreementTerms } from "@kin/domain";
import { asc, eq, inArray, sql } from "drizzle-orm";

import type { CareAgreementRecord } from "./circle-snapshot.ts";
import type { Transaction } from "./connection.ts";
import { careAgreementSignatures, careAgreements, circles } from "./schema/index.ts";

/**
 * `refused`: the person may not do this, or the agreement is not theirs.
 * `invalid`: the terms are not an agreement the template can hold.
 * `closed`: the agreement is withdrawn, ended, not yet signed by both sides, or already signed by both.
 * `ended`: it was ended already, on another day.
 * `signed`: someone else already signed for that side.
 * `pay_rate`: the agreement does not state the caregiver's current pay rate.
 * `overlap`: a signed agreement for the caregiver already covers the day this one would begin.
 */
export type CareAgreementReason = "refused" | "invalid" | "closed" | "ended" | "signed" | "pay_rate" | "overlap";

/** A care agreement could not be written, signed, withdrawn or ended. Retrying the same request cannot help. */
export class CareAgreementError extends Error {
  readonly retryable = false;
  readonly reason: CareAgreementReason;

  constructor(reason: CareAgreementReason) {
    super(`Care agreement refused: ${reason}`);
    this.name = "CareAgreementError";
    this.reason = reason;
  }
}

/**
 * The agreements the person may read, oldest first, with their signatures and
 * where each stands on the circle's calendar day. Read as the person:
 * row-level security returns a caregiver only their own. `now` is the clock
 * for a circle with none of its own.
 */
export async function readCareAgreements(tx: Transaction, circleId: string, now: Date = new Date()): Promise<CareAgreementRecord[]> {
  const [circle] = await tx.select({ clockAt: circles.clockAt, timezone: circles.timezone }).from(circles).where(eq(circles.id, circleId));
  if (!circle) return [];
  const today = calendarDay(circle.clockAt ?? now, circle.timezone).occurredOn;
  const rows = await tx.select().from(careAgreements).where(eq(careAgreements.circleId, circleId)).orderBy(asc(careAgreements.createdAt), asc(careAgreements.id));
  if (rows.length === 0) return [];
  const signed = await tx
    .select()
    .from(careAgreementSignatures)
    .where(inArray(careAgreementSignatures.agreementId, rows.map((row) => row.id)))
    .orderBy(asc(careAgreementSignatures.signedAt), asc(careAgreementSignatures.id));
  const signaturesOf = Map.groupBy(signed, (signature) => signature.agreementId);
  return rows.map((row): CareAgreementRecord => {
    const signatures = (signaturesOf.get(row.id) ?? []).map((signature) => ({
      memberId: signature.memberId,
      capacity: signature.capacity,
      signedOn: signature.signedOn,
      method: signature.method,
      at: signature.signedAt,
    }));
    const facts: CareAgreementFacts = {
      id: row.id,
      payeeId: row.payeeId,
      state: row.state,
      rateCentsPerHour: row.rateCentsPerHour,
      startsOn: row.startsOn,
      endTerm: row.endTerm,
      endsOn: row.endsOn,
      endedOn: row.endedOn,
      signatures: signatures.map(({ memberId, capacity, signedOn }) => ({ memberId, capacity, signedOn })),
    };
    return {
      id: row.id,
      payeeId: row.payeeId,
      caregiverMemberId: row.caregiverMemberId,
      caregiverRelation: row.caregiverRelation,
      duties: row.duties,
      weeklyMinutes: row.weeklyMinutes,
      rateCentsPerHour: row.rateCentsPerHour,
      startsOn: row.startsOn,
      endTerm: row.endTerm,
      endsOn: row.endsOn,
      endedOn: row.endedOn,
      payer: row.payer,
      usState: row.usState,
      state: row.state,
      simulated: row.simulated,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      signatures,
      status: careAgreementStatus(facts, today),
      facts,
    };
  });
}

/**
 * Writes a draft care agreement, as the organizer. The terms must already
 * have passed `checkCareAgreementTerms`; the database checks them again, a
 * spouse included. Proposing the same terms again while that draft stands
 * returns it.
 */
export async function proposeCareAgreement(tx: Transaction, input: { readonly circleId: string; readonly terms: CareAgreementTerms }): Promise<string> {
  const { terms } = input;
  return careAgreementOperation(async () => {
    const result = await tx.execute<{ id: string }>(sql`select kin_private.propose_care_agreement(${input.circleId}::uuid, ${JSON.stringify(terms)}::jsonb) as id`);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("The care agreement proposal returned no agreement");
    return id;
  });
}

/**
 * The person signs in their own seat: the caregiver as the caregiver, the
 * parent as the care recipient, the organizer for the parent. The database
 * works out which from the seat. Signing twice changes nothing.
 */
export async function signCareAgreement(tx: Transaction, input: { readonly circleId: string; readonly agreementId: string }): Promise<void> {
  await careAgreementOperation(() => tx.execute(sql`select kin_private.sign_care_agreement(${input.circleId}::uuid, ${input.agreementId}::uuid)`));
}

/** Takes back a draft that both sides have not yet signed, as the organizer. Withdrawing twice changes nothing. */
export async function withdrawCareAgreement(tx: Transaction, input: { readonly circleId: string; readonly agreementId: string }): Promise<void> {
  await careAgreementOperation(() => tx.execute(sql`select kin_private.withdraw_care_agreement(${input.circleId}::uuid, ${input.agreementId}::uuid)`));
}

/** Ends an agreement both sides signed, after `endedOn` (a calendar day), as the organizer. Once. */
export async function endCareAgreement(tx: Transaction, input: { readonly circleId: string; readonly agreementId: string; readonly endedOn: string }): Promise<void> {
  await careAgreementOperation(() => tx.execute(sql`select kin_private.end_care_agreement(${input.circleId}::uuid, ${input.agreementId}::uuid, ${input.endedOn}::date)`));
}

const REASONS: Readonly<Record<string, CareAgreementReason>> = {
  "42501": "refused",
  "23514": "invalid",
  "22P02": "invalid",
  "22007": "invalid",
  "22008": "invalid",
  KC001: "closed",
  KC002: "ended",
  KC003: "signed",
  KC004: "pay_rate",
  KC005: "overlap",
};

async function careAgreementOperation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[codeOf(error) ?? ""];
    if (reason) throw new CareAgreementError(reason);
    throw error;
  }
}

function codeOf(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? codeOf(error.cause) : null;
}

/**
 * The care agreement gate: a caregiver payout is refused for any day of work
 * that no signed agreement covers at the rate being paid, once the caregiver
 * has one on file. A
 * caregiver with none is paid and listed as undocumented instead, so the
 * family is never locked out of paying for care it has not yet written down.
 * Read as the person or as Kin's service, whose reads row-level security
 * already limits to this circle.
 */
export async function assertCaregiverWorkCovered(
  tx: Transaction,
  input: { readonly circleId: string; readonly payeeId: string; readonly workDates: readonly string[]; readonly rateCentsPerHour: number },
): Promise<void> {
  const own = (await readCareAgreements(tx, input.circleId)).filter((agreement) => agreement.payeeId === input.payeeId).map((agreement) => agreement.facts);
  assertWorkCovered(input.workDates, own, input.rateCentsPerHour);
}
