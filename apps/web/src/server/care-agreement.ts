import { authorize } from "@kin/auth";
import { CareAgreementError, asPerson, endCareAgreement, proposeCareAgreement, signCareAgreement, withdrawCareAgreement, type CareAgreementReason, type CircleSnapshot, type Database } from "@kin/db";
import {
  CareAgreementTermsError,
  careAgreementClauses,
  checkCareAgreementTerms,
  judgeRate,
  type AgreementClause,
  type CareAgreementTerms,
  type CareEndTerm,
  type CarePayer,
  type CareRelation,
  type RateBenchmark,
  type RateJudgement,
  type UsState,
} from "@kin/domain";

import { parentNameOf } from "@/content/circle/members";

import { englishDay, englishMoney } from "./packet/english";

export type CareAgreementContext = { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot };
export type CareAgreementFailure = CareAgreementReason | CareAgreementTermsError["reason"] | "unavailable";
export type CareAgreementPreview = {
  readonly clauses: readonly AgreementClause[];
  readonly rate: { readonly judgement: RateJudgement; readonly rate: string; readonly median: string | null; readonly benchmark: RateBenchmark | null };
};
export type CareAgreementResult =
  | { readonly ok: true; readonly preview: CareAgreementPreview }
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: CareAgreementFailure };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DUTIES_TEXT = 2_400;

/**
 * The one request boundary for care agreements: an organizer reviews draft
 * terms (checked and shown as the agreement will read, nothing stored),
 * saves them as a draft, withdraws a draft or ends a signed agreement; the
 * caregiver, the parent or the organizer signs. The caregiver is read from
 * the circle's own payee, never from the browser, and so is the rate: an
 * agreement states the caregiver's pay rate. The template is fixed text: no
 * model writes a clause.
 */
export async function runCareAgreement(context: CareAgreementContext, input: unknown): Promise<CareAgreementResult> {
  const row = record(input);
  if (row === null) return refusal("invalid");
  const seat = { role: context.circle.viewer.role, status: "active" as const };
  const circleId = context.circle.circle.id;
  try {
    if (row.operation === "review" || row.operation === "propose") {
      if (!authorize(seat, "care_agreement.propose").allowed) return refusal("refused");
      if (!keys(row, ["operation", "draft"])) return refusal("invalid");
      const terms = draftTerms(context.circle, row.draft);
      if (terms === null) return refusal("invalid");
      if (row.operation === "review") return { ok: true, preview: previewOf(context.circle, terms) };
      const id = await asPerson(context.db, context.userId, (tx) => proposeCareAgreement(tx, { circleId, terms }));
      return { ok: true, id };
    }
    const agreementId = idOf(row);
    if (agreementId === null) return refusal("invalid");
    if (row.operation === "sign") {
      if (!authorize(seat, "care_agreement.sign").allowed) return refusal("refused");
      await asPerson(context.db, context.userId, (tx) => signCareAgreement(tx, { circleId, agreementId }));
      return { ok: true, id: agreementId };
    }
    if (row.operation === "withdraw") {
      if (!authorize(seat, "care_agreement.manage").allowed) return refusal("refused");
      await asPerson(context.db, context.userId, (tx) => withdrawCareAgreement(tx, { circleId, agreementId }));
      return { ok: true, id: agreementId };
    }
    if (row.operation === "end") {
      if (!authorize(seat, "care_agreement.manage").allowed) return refusal("refused");
      if (!keys(row, ["operation", "agreementId", "endedOn"]) || typeof row.endedOn !== "string" || !DAY.test(row.endedOn)) return refusal("invalid");
      const endedOn = row.endedOn;
      await asPerson(context.db, context.userId, (tx) => endCareAgreement(tx, { circleId, agreementId, endedOn }));
      return { ok: true, id: agreementId };
    }
    return refusal("invalid");
  } catch (error) {
    if (error instanceof CareAgreementTermsError || error instanceof CareAgreementError) return refusal(error.reason);
    throw error;
  }
}

/** The agreement's names and figures, in English, as the template needs them. */
export function agreementNames(circle: CircleSnapshot, terms: Pick<CareAgreementTerms, "caregiverMemberId" | "rateCentsPerHour">) {
  const caregiver = circle.members.find((member) => member.id === terms.caregiverMemberId)?.displayName ?? "the caregiver";
  return { caregiver, careRecipient: parentNameOf(circle), rate: englishMoney(terms.rateCentsPerHour, circle.circle.currency), day: englishDay };
}

function previewOf(circle: CircleSnapshot, terms: CareAgreementTerms): CareAgreementPreview {
  const { judgement, benchmark } = judgeRate(terms.rateCentsPerHour, circle.circle.currency);
  return {
    clauses: careAgreementClauses(terms, agreementNames(circle, terms)),
    rate: { judgement, rate: englishMoney(terms.rateCentsPerHour, circle.circle.currency), median: benchmark === null ? null : englishMoney(benchmark.medianCentsPerHour, benchmark.currency), benchmark },
  };
}

/**
 * The draft as the form sends it, read into terms and checked. `null` when its
 * shape is not the form's, or the caregiver has no pay rate; a rule it breaks
 * throws. The rate is the caregiver's pay rate, read here from the record.
 */
function draftTerms(circle: CircleSnapshot, value: unknown): CareAgreementTerms | null {
  const draft = record(value);
  if (draft === null || !keys(draft, ["payeeId", "relation", "duties", "hours", "startsOn", "endTerm", "endsOn", "payer", "state"])) return null;
  const { payeeId, relation, duties, hours, startsOn, endTerm, endsOn, payer, state } = draft;
  if (typeof payeeId !== "string" || !UUID.test(payeeId) || typeof relation !== "string" || typeof duties !== "string" || duties.length > MAX_DUTIES_TEXT) return null;
  if (typeof hours !== "string" || typeof startsOn !== "string" || !DAY.test(startsOn)) return null;
  if (typeof endTerm !== "string" || (endsOn !== null && typeof endsOn !== "string") || typeof payer !== "string" || typeof state !== "string") return null;
  const payee = circle.payees.find((each) => each.id === payeeId);
  const member = payee?.payee.member;
  if (payee === undefined || member == null || member.role !== "caregiver" || payee.caregiverRateCentsPerHour === null) return null;
  if (!/^\d{1,2}$/.test(hours.trim())) return null;
  return checkCareAgreementTerms({
    payeeId,
    caregiverMemberId: member.memberId,
    caregiverRelation: relation as CareRelation,
    duties: duties.split("\n").filter((line) => line.trim() !== ""),
    weeklyMinutes: Number(hours.trim()) * 60,
    rateCentsPerHour: payee.caregiverRateCentsPerHour,
    startsOn,
    endTerm: endTerm as CareEndTerm,
    endsOn: endsOn === null ? null : endsOn,
    payer: payer as CarePayer,
    state: state as UsState,
  });
}

const idOf = (row: Record<string, unknown>): string | null => (typeof row.agreementId === "string" && UUID.test(row.agreementId) ? row.agreementId : null);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function keys(row: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(row).every((key) => allowed.includes(key));
}
function refusal(reason: CareAgreementFailure): CareAgreementResult {
  return { ok: false, reason };
}
