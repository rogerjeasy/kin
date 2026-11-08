import { authorize } from "@kin/auth";
import { MandateError, asPerson, grantMandate, newMandateId, setMandateStatus, type CircleSnapshot, type Database, type MandateReason } from "@kin/db";
import { InvalidDecimalError, MANDATE_CADENCES, MandateTermsError, calendarDay, centsFromDecimal, checkMandateTerms, mandateExcessAboveParentLimit, parentMustDecide, type MandateTerms } from "@kin/domain";
import { typedAmount } from "@/lib/typed-amount";

export type MandateContext = { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot };
export type MandateFailure = MandateReason | "amount" | "unavailable";
export type MandateResult =
  /** `aboveUsualCents`: how far the per-purchase cap passes what the parent usually decides herself, 0 when it does not. */
  | { readonly ok: true; readonly terms: MandateTerms; readonly aboveUsualCents: number }
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: MandateFailure };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPOKEN_CHARS = 400;
const STATUS_OF = { pause: "paused", resume: "active", revoke: "revoked" } as const;

/**
 * The one request boundary for the parent's standing permission. The parent
 * (or, in a demo circle, the organizer playing her spoken yes) reviews the
 * terms Kin will read back, then grants them; any member who answers may pause
 * one, and the parent ends it. The browser sends words and decimals only: the
 * rule must be one of this circle's, the amounts are read again here digit by
 * digit, and every limit is checked by plain code in `packages/domain` and
 * again by the database.
 */
export async function runMandate(context: MandateContext, input: unknown): Promise<MandateResult> {
  const row = record(input);
  if (row === null) return refusal("invalid");
  const seat = { role: context.circle.viewer.role, status: "active" as const };
  const circleId = context.circle.circle.id;
  try {
    if (row["operation"] === "review" || row["operation"] === "grant") {
      if (!authorize(seat, "mandate.grant").allowed) return refusal("refused");
      if (!keys(row, ["operation", "draft", "spokenText"]) || (row["operation"] === "review" && row["spokenText"] !== undefined)) return refusal("invalid");
      const terms = draftTerms(context.circle, row["draft"]);
      if (terms === null) return refusal("invalid");
      const ceiling = context.circle.agreement?.approvals.ceilingCents;
      if (ceiling === undefined) return refusal("no_agreement");
      checkMandateTerms(terms, ceiling);
      if (row["operation"] === "review") return { ok: true, terms, aboveUsualCents: excessAboveUsualLimit(context.circle, terms) };
      const spoken = row["spokenText"];
      if (spoken !== undefined && (typeof spoken !== "string" || spoken.length > MAX_SPOKEN_CHARS)) return refusal("invalid");
      const id = newMandateId();
      await asPerson(context.db, context.userId, (tx) =>
        grantMandate(tx, { circleId, id, ...terms, spokenText: typeof spoken === "string" ? spoken : null, now: context.circle.circle.now }),
      );
      return { ok: true, id };
    }
    const operation = typeof row["operation"] === "string" ? row["operation"] : "";
    if (operation === "pause" || operation === "resume" || operation === "revoke") {
      if (!authorize(seat, operation === "pause" ? "mandate.pause" : "mandate.grant").allowed) return refusal("refused");
      const mandateId = row["mandateId"];
      if (!keys(row, ["operation", "mandateId"]) || typeof mandateId !== "string" || !UUID.test(mandateId)) return refusal("invalid");
      await asPerson(context.db, context.userId, (tx) => setMandateStatus(tx, { circleId, mandateId, status: STATUS_OF[operation] }));
      return { ok: true, id: mandateId };
    }
    return refusal("invalid");
  } catch (error) {
    if (error instanceof MandateTermsError || error instanceof MandateError) return refusal(error.reason);
    if (error instanceof InvalidDecimalError) return refusal("amount");
    throw error;
  }
}

/** The parent's level and the agreement's thresholds, or `null` when either is missing. */
function parentDecision(circle: CircleSnapshot) {
  const level = circle.members.find((member) => member.role === "parent" && member.status === "active")?.parentLevel;
  return level && circle.agreement ? { level, approvals: circle.agreement.approvals } : null;
}

/** How far a mandate's cap passes what the parent usually decides herself, by the approval plan's own rule. */
export function excessAboveUsualLimit(circle: CircleSnapshot, terms: MandateTerms): number {
  const decision = parentDecision(circle);
  return decision ? mandateExcessAboveParentLimit(terms, decision.level, decision.approvals) : 0;
}

/** Whether the parent herself would have been asked about an amount, so a standing permission that bought it went above her usual limit. */
export function aboveUsualLimit(circle: CircleSnapshot, cents: number): boolean {
  const decision = parentDecision(circle);
  return decision !== null && parentMustDecide(cents, decision.level, decision.approvals);
}

/** The draft as the form sends it, read into terms. `null` when its shape is not the form's. */
function draftTerms(circle: CircleSnapshot, value: unknown): MandateTerms | null {
  const draft = record(value);
  if (draft === null || !keys(draft, ["ruleId", "perPurchase", "perPeriod", "cadence", "validFrom", "expiresOn"])) return null;
  const { ruleId, perPurchase, perPeriod, cadence, validFrom, expiresOn } = draft;
  if (typeof ruleId !== "string" || !circle.purchaseRules.some((rule) => rule.id === ruleId)) return null;
  if (typeof perPurchase !== "string" || typeof perPeriod !== "string" || typeof validFrom !== "string" || typeof expiresOn !== "string") return null;
  if (!DAY.test(validFrom) || !DAY.test(expiresOn)) return null;
  const known = MANDATE_CADENCES.find((each) => each === cadence);
  if (known === undefined) return null;
  const { currency, now, timezone } = circle.circle;
  // A permission cannot start before today on the circle's calendar: it starts when it is spoken.
  const today = calendarDay(now, timezone).occurredOn;
  return {
    ruleId,
    perPurchaseCents: centsFromDecimal(typedAmount(perPurchase), currency),
    perPeriodCents: centsFromDecimal(typedAmount(perPeriod), currency),
    cadence: known,
    validFrom: validFrom < today ? today : validFrom,
    expiresOn,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function keys(row: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(row).every((key) => allowed.includes(key));
}
function refusal(reason: MandateFailure): MandateResult {
  return { ok: false, reason };
}
