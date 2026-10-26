import { agreementStanding, type Agreement, type AgreementStanding, type AgreementTerms } from "@kin/domain";
import { asc, eq, inArray, sql } from "drizzle-orm";

import type { AgreementVersionRecord } from "./circle-snapshot.ts";
import type { Transaction } from "./connection.ts";
import { agreementAcceptances, agreements, agreementShares } from "./schema/index.ts";

export type AgreementReason = "refused" | "invalid" | "superseded";

/** A version could not be proposed or accepted. Retrying the same request cannot help. */
export class AgreementError extends Error {
  readonly retryable = false;
  readonly reason: AgreementReason;

  constructor(reason: AgreementReason) {
    super(`Agreement refused: ${reason}`);
    this.name = "AgreementError";
    this.reason = reason;
  }
}

/**
 * Every version the person may read, oldest first, with its shares and who
 * accepted it, and which one governs on `today`. Read as the person:
 * row-level security returns nothing to a role that may not see the agreement.
 */
export async function readAgreementVersions(tx: Transaction, circleId: string, today: string): Promise<{ readonly versions: readonly AgreementVersionRecord[]; readonly standing: AgreementStanding }> {
  const rows = await tx.select().from(agreements).where(eq(agreements.circleId, circleId)).orderBy(asc(agreements.version));
  const ids = rows.map((row) => row.id);
  const shares = ids.length === 0 ? [] : await tx.select().from(agreementShares).where(inArray(agreementShares.agreementId, ids)).orderBy(asc(agreementShares.position));
  const accepted = ids.length === 0 ? [] : await tx.select().from(agreementAcceptances).where(inArray(agreementAcceptances.agreementId, ids)).orderBy(asc(agreementAcceptances.acceptedAt));
  const sharesOf = Map.groupBy(shares, (share) => share.agreementId);
  const acceptancesOf = Map.groupBy(accepted, (each) => each.agreementId);
  const standing = agreementStanding(
    rows.map((row) => ({
      version: row.version,
      effectiveOn: row.effectiveOn,
      // Versions written before signers were recorded ask their share holders.
      requiredMemberIds: row.requires ?? (sharesOf.get(row.id) ?? []).map((share) => share.memberId),
      acceptedMemberIds: (acceptancesOf.get(row.id) ?? []).map((each) => each.memberId),
    })),
    today,
  );
  const versions = rows.map((row): AgreementVersionRecord => {
    const care: Agreement["care"] = row.careRateCentsPerHour === null ? null : { rateCentsPerHour: row.careRateCentsPerHour, paidInCash: row.carePaidInCash };
    return {
      id: row.id,
      version: row.version,
      effectiveOn: row.effectiveOn,
      proposedAt: row.createdAt,
      shares: (sharesOf.get(row.id) ?? []).map((share) => ({ memberId: share.memberId, bps: share.bps })),
      care,
      approvals: { ceilingCents: row.ceilingCents, secondApprovalAboveCents: row.secondApprovalAboveCents, parentDecidesAboveCents: row.parentDecidesAboveCents },
      acceptances: (acceptancesOf.get(row.id) ?? []).map((each) => ({ memberId: each.memberId, method: each.method, at: each.acceptedAt })),
      status: standing.statuses.get(row.version) ?? "superseded",
      waitingFor: standing.waitingFor.get(row.version) ?? [],
    };
  });
  return { versions, standing };
}

/**
 * Proposes a new version of the agreement, as the organizer, who accepts it
 * by proposing it. The terms must already have passed `checkAgreementTerms`;
 * the database checks them again and numbers the version.
 */
export async function proposeAgreement(tx: Transaction, input: { readonly circleId: string; readonly terms: AgreementTerms }): Promise<string> {
  const { terms } = input;
  return agreementOperation(async () => {
    const result = await tx.execute<{ id: string }>(sql`select kin_private.propose_agreement(
      ${input.circleId}::uuid, ${terms.effectiveOn}::date, ${terms.care?.rateCentsPerHour ?? null}::bigint, ${terms.care?.paidInCash ?? false},
      ${terms.approvals.ceilingCents}::bigint, ${terms.approvals.secondApprovalAboveCents}::bigint, ${terms.approvals.parentDecidesAboveCents}::bigint,
      ${JSON.stringify(terms.shares.map((share) => ({ memberId: share.memberId, bps: share.bps })))}::jsonb) as id`);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("The agreement proposal returned no version");
    return id;
  });
}

/** The person accepts the newest version, in their own seat. Accepting twice changes nothing. */
export async function acceptAgreement(tx: Transaction, input: { readonly circleId: string; readonly agreementId: string }): Promise<void> {
  await agreementOperation(() => tx.execute(sql`select kin_private.accept_agreement(${input.circleId}::uuid, ${input.agreementId}::uuid)`));
}

const REASONS: Readonly<Record<string, AgreementReason>> = { "42501": "refused", "23514": "invalid", "22P02": "invalid", "22007": "invalid", "22008": "invalid", KB011: "superseded" };

async function agreementOperation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[codeOf(error) ?? ""];
    if (reason) throw new AgreementError(reason);
    throw error;
  }
}

function codeOf(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? codeOf(error.cause) : null;
}
