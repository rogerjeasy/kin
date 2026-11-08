import { CIRCLE_ACTIONS, authorize } from "@kin/auth";
import { AgreementError, acceptAgreement, asPerson, proposeAgreement, type AgreementReason, type CircleSnapshot, type Database } from "@kin/db";
import {
  AgreementTermsError,
  InvalidDecimalError,
  agreementChanges,
  bpsFromPercent,
  calendarDay,
  centsFromDecimal,
  checkAgreementTerms,
  type AgreementChange,
  type AgreementTerms,
} from "@kin/domain";
import { typedAmount } from "@/lib/typed-amount";

export type AgreementContext = { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot };
export type AgreementFailure = AgreementReason | AgreementTermsError["reason"] | "amount" | "unavailable";
export type AgreementResult =
  | { readonly ok: true; readonly terms: AgreementTerms; readonly changes: readonly AgreementChange[] }
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: AgreementFailure };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The one request boundary for the family agreement: an organizer reviews
 * draft terms (checked and explained, nothing stored), proposes them as a new
 * version, and a member who shares the cost, or the parent, accepts the
 * newest version. Nothing typed in the browser is trusted: percentages and
 * amounts are read again here, digit by digit.
 */
export async function runAgreement(context: AgreementContext, input: unknown): Promise<AgreementResult> {
  const row = record(input);
  if (row === null) return refusal("invalid");
  const seat = { role: context.circle.viewer.role, status: "active" as const };
  try {
    if (row.operation === "review" || row.operation === "propose") {
      if (!authorize(seat, "agreement.propose").allowed) return refusal("refused");
      if (!keys(row, ["operation", "draft"])) return refusal("invalid");
      const terms = draftTerms(context.circle, row.draft);
      if (terms === null) return refusal("invalid");
      if (row.operation === "review") return { ok: true, terms, changes: agreementChanges(context.circle.agreement, terms) };
      const id = await asPerson(context.db, context.userId, (tx) => proposeAgreement(tx, { circleId: context.circle.circle.id, terms }));
      return { ok: true, id };
    }
    if (row.operation === "accept") {
      if (!authorize(seat, "agreement.accept").allowed) return refusal("refused");
      if (!keys(row, ["operation", "agreementId"]) || typeof row.agreementId !== "string" || !UUID.test(row.agreementId)) return refusal("invalid");
      const agreementId = row.agreementId;
      await asPerson(context.db, context.userId, (tx) => acceptAgreement(tx, { circleId: context.circle.circle.id, agreementId }));
      return { ok: true, id: agreementId };
    }
    return refusal("invalid");
  } catch (error) {
    if (error instanceof AgreementTermsError || error instanceof AgreementError) return refusal(error.reason);
    if (error instanceof InvalidDecimalError) return refusal("amount");
    throw error;
  }
}

/**
 * The members who may hold a share: those who share the cost by role, in the
 * order the agreement in force lists them, then anyone who has joined since.
 */
export function sharingMembers(circle: CircleSnapshot): string[] {
  const roles: readonly string[] = CIRCLE_ACTIONS["money.contribute"];
  const eligible = circle.members.filter((member) => member.status === "active" && roles.includes(member.role)).map((member) => member.id);
  const written = (circle.agreement?.shares ?? []).map((share) => share.memberId).filter((id) => eligible.includes(id));
  return [...written, ...eligible.filter((id) => !written.includes(id))];
}

/**
 * The draft as the form sends it, read into terms and checked against every
 * rule. `null` when its shape is not the form's; a rule it breaks throws.
 */
function draftTerms(circle: CircleSnapshot, value: unknown): AgreementTerms | null {
  const draft = record(value);
  if (draft === null || !keys(draft, ["shares", "care", "approvals", "effectiveOn"])) return null;
  const { currency, now, timezone } = circle.circle;
  if (!Array.isArray(draft.shares) || draft.shares.length > 20 || typeof draft.effectiveOn !== "string" || !DAY.test(draft.effectiveOn)) return null;
  const shares = draft.shares.map((each: unknown) => {
    const share = record(each);
    if (share === null || !keys(share, ["memberId", "percent"]) || typeof share.memberId !== "string" || typeof share.percent !== "string") return null;
    return { memberId: share.memberId, bps: bpsFromPercent(share.percent) };
  });
  if (shares.some((share) => share === null)) return null;
  const approvals = record(draft.approvals);
  if (approvals === null || !keys(approvals, ["ceiling", "second", "parent"]) || ![approvals.ceiling, approvals.second, approvals.parent].every((amount) => typeof amount === "string")) return null;
  const care = draft.care === null ? null : record(draft.care);
  if (draft.care !== null && (care === null || !keys(care, ["rate", "paidInCash"]) || typeof care.rate !== "string" || typeof care.paidInCash !== "boolean")) return null;
  const amount = (text: unknown) => centsFromDecimal(typedAmount(String(text)), currency);
  return checkAgreementTerms(
    {
      shares: shares.filter((share) => share !== null),
      care: care === null ? null : { rateCentsPerHour: amount(care.rate), paidInCash: care.paidInCash === true },
      approvals: { ceilingCents: amount(approvals.ceiling), secondApprovalAboveCents: amount(approvals.second), parentDecidesAboveCents: amount(approvals.parent) },
      effectiveOn: draft.effectiveOn,
    },
    { today: calendarDay(now, timezone).occurredOn, sharingMemberIds: sharingMembers(circle) },
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function keys(row: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(row).every((key) => allowed.includes(key));
}
function refusal(reason: AgreementFailure): AgreementResult {
  return { ok: false, reason };
}
