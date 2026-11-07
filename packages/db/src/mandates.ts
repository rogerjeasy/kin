import {
  MandateTermsError,
  calendarDay,
  checkMandateTerms,
  isPaused,
  type MandateCadence,
  type MandateCandidate,
  type MandateStatus,
  type MandateTerms,
  type MandateTermsRefusal,
} from "@kin/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import { readAgreementVersions } from "./agreements.ts";
import { postgresError } from "./caregiver-billing.ts";
import type { MandateRecord } from "./circle-snapshot.ts";
import type { Transaction } from "./connection.ts";
import { circles, mandateUses, mandates, proposals } from "./schema/index.ts";

export type MandateReason = MandateTermsRefusal | "refused" | "invalid" | "parent_only" | "no_parent" | "no_agreement" | "key_reused";

/** A mandate cannot be granted, paused or ended. Asking again cannot help until what blocks it changes. */
export class MandateError extends Error {
  readonly retryable = false;
  readonly reason: MandateReason;

  constructor(reason: MandateReason) {
    super(`A mandate cannot be changed: ${reason}`);
    this.name = "MandateError";
    this.reason = reason;
  }
}

const REASONS: Readonly<Record<string, MandateReason>> = {
  "42501": "refused", "23514": "invalid", "22P02": "invalid", "22007": "invalid", "22008": "invalid", "22003": "invalid",
  "23001": "invalid", KM001: "parent_only", KM002: "no_parent", KB004: "key_reused", KB006: "above_ceiling", KB008: "no_agreement",
};

// The database's own refusals become typed reasons the screens can word.
async function operation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[postgresError(error)?.code ?? ""];
    if (reason) throw new MandateError(reason);
    throw error;
  }
}

/** What counts toward a mandate's period: a purchase still waiting, under way or done. */
const COUNTED = ["pending_approval", "approved", "executing", "settled"] as const;

/**
 * Records the parent's standing permission. The terms are checked by plain
 * code in `packages/domain` against the agreement's ceiling, and the database
 * asserts the same again, seals the terms with a digest and records who
 * recorded it. A retry with the same `id` grants it once. Run as the person,
 * inside `asPerson`.
 */
export async function grantMandate(
  tx: Transaction,
  input: { readonly circleId: string; readonly id: string } & MandateTerms & { readonly spokenText: string | null; readonly now: Date },
): Promise<string> {
  const { circleId, id, now, spokenText, ...terms } = input;
  const [circle] = await tx.select({ timezone: circles.timezone }).from(circles).where(eq(circles.id, circleId));
  if (!circle) throw new MandateError("refused");
  const { versions } = await readAgreementVersions(tx, circleId, calendarDay(now, circle.timezone).occurredOn);
  const agreement = versions.find((version) => version.status === "in_force");
  // No agreement can mean none exists or that this person may not read it: the database tells the two apart.
  try {
    if (agreement) checkMandateTerms(terms, agreement.approvals.ceilingCents);
  } catch (error) {
    if (error instanceof MandateTermsError) throw new MandateError(error.reason);
    throw error;
  }
  await operation(() =>
    tx.execute(sql`select kin_private.grant_mandate(
      ${circleId}::uuid, ${id}::uuid, ${terms.ruleId}::uuid, ${terms.perPurchaseCents}::bigint, ${terms.perPeriodCents}::bigint, ${terms.cadence},
      ${terms.validFrom}::date, ${terms.expiresOn}::date, ${spokenText})`),
  );
  return id;
}

/** Pauses, resumes or ends a mandate. The database decides who may, and refuses a move its diagram does not draw. */
export async function setMandateStatus(tx: Transaction, input: { readonly circleId: string; readonly mandateId: string; readonly status: MandateStatus }): Promise<void> {
  await operation(() => tx.execute(sql`select kin_private.set_mandate_status(${input.circleId}::uuid, ${input.mandateId}::uuid, ${input.status}::mandate_status)`));
}

/**
 * The seal of a mandate's terms: SHA-256 of the text PostgreSQL makes of
 * `jsonb_build_array(...)` for them, which is what the database stores when it
 * grants one. A seeded mandate is sealed the same way, so every digest checks alike.
 */
export function mandateDigest(terms: MandateTerms): string {
  const parts = [terms.ruleId, terms.perPurchaseCents, terms.perPeriodCents, terms.cadence, terms.validFrom, terms.expiresOn].map((part) => JSON.stringify(part));
  return createHash("sha256").update("[" + parts.join(", ") + "]", "utf8").digest("hex");
}

/** A new ID for a mandate, so a retried request grants it once. */
export const newMandateId = (): string => randomUUID();

type Use = { readonly mandateId: string; readonly proposalId: string; readonly cents: number; readonly period: string; readonly createdAt: Date; readonly state: string };

async function readUses(tx: Transaction, circleId: string): Promise<Use[]> {
  return tx
    .select({ mandateId: mandateUses.mandateId, proposalId: mandateUses.proposalId, cents: mandateUses.cents, period: mandateUses.period, createdAt: mandateUses.createdAt, state: proposals.state })
    .from(mandateUses)
    .innerJoin(proposals, and(eq(proposals.circleId, mandateUses.circleId), eq(proposals.id, mandateUses.proposalId)))
    .where(eq(mandateUses.circleId, circleId))
    .orderBy(mandateUses.createdAt, mandateUses.id);
}

/** The circle's mandates with what each has spent this period, as the person looking may see them. */
export async function readMandateRecords(tx: Transaction, circleId: string, now: Date, timezone: string): Promise<MandateRecord[]> {
  const rows = await tx.select().from(mandates).where(eq(mandates.circleId, circleId)).orderBy(mandates.createdAt, mandates.id);
  const uses = await readUses(tx, circleId);
  const period = calendarDay(now, timezone).period;
  return rows.map((row) => {
    const own = uses.filter((use) => use.mandateId === row.id);
    const counted = own.filter((use) => use.period === period && (COUNTED as readonly string[]).includes(use.state));
    return {
      id: row.id,
      ruleId: row.ruleId,
      grantedBy: row.grantedBy,
      recordedBy: row.recordedBy,
      perPurchaseCents: row.perPurchaseCents,
      perPeriodCents: row.perPeriodCents,
      cadence: row.cadence as MandateCadence,
      validFrom: row.validFrom,
      expiresOn: row.expiresOn,
      status: row.status,
      spokenText: row.spokenText,
      simulated: row.simulated,
      digest: row.digest,
      grantedAt: row.grantedAt,
      endedAt: row.endedAt,
      usedCents: counted.reduce((sum, use) => sum + use.cents, 0),
      usedCount: counted.length,
      uses: own.map((use) => ({ proposalId: use.proposalId, cents: use.cents, period: use.period, at: use.createdAt, state: use.state })),
    };
  });
}

/** The live mandates that could cover a refill under `ruleId`, with this period's use, ready for the domain's check. */
export async function readMandateCandidates(
  tx: Transaction,
  input: { readonly circleId: string; readonly ruleId: string; readonly now: Date; readonly timezone: string; readonly pausedUntil: Date | null },
): Promise<MandateCandidate[]> {
  const live = await tx
    .select({ id: mandates.id })
    .from(mandates)
    .where(and(eq(mandates.circleId, input.circleId), eq(mandates.ruleId, input.ruleId), inArray(mandates.status, ["active", "paused"])));
  if (live.length === 0) return [];
  const records = await readMandateRecords(tx, input.circleId, input.now, input.timezone);
  const today = calendarDay(input.now, input.timezone).occurredOn;
  return records
    .filter((record) => live.some((each) => each.id === record.id))
    .map((record) => ({
      mandate: {
        mandateId: record.id,
        ruleId: record.ruleId,
        perPurchaseCents: record.perPurchaseCents,
        perPeriodCents: record.perPeriodCents,
        cadence: record.cadence,
        validFrom: record.validFrom,
        expiresOn: record.expiresOn,
        status: record.status,
      },
      today,
      circlePaused: isPaused(input.pausedUntil, input.now),
      usedCents: record.usedCents,
      usedCount: record.usedCount,
    }));
}
