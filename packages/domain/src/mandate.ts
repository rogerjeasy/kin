import type { ApprovalTerms } from "./agreement.ts";
import { parentMustDecide } from "./approval-plan.ts";
import { assertCents } from "./money.ts";
import type { ParentLevel } from "./roles.ts";

/**
 * A mandate is the parent's standing permission, spoken once: Kin may buy one
 * refill rule's item for her, within a limit for each purchase and a budget
 * for each month, between two dates (docs/feature-proposals.md section 1).
 * Whether a refill fits it is decided here by plain code, never by the model.
 */
export const MANDATE_CADENCES = ["monthly", "as_needed"] as const;
export type MandateCadence = (typeof MANDATE_CADENCES)[number];

export const MANDATE_STATUSES = ["active", "paused", "revoked"] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

/** A standing permission may not run longer than a year without being spoken again. */
export const MAX_MANDATE_DAYS = 366;

/** What the parent allowed, as the schema Kin compiles her words into. Dates are YYYY-MM-DD on the circle's calendar. */
export type MandateTerms = {
  /** The refill rule it covers, which fixes the seller and the kind of thing bought. */
  readonly ruleId: string;
  readonly perPurchaseCents: number;
  readonly perPeriodCents: number;
  readonly cadence: MandateCadence;
  readonly validFrom: string;
  readonly expiresOn: string;
};

export type Mandate = MandateTerms & { readonly mandateId: string; readonly status: MandateStatus };

export type MandateTermsRefusal = "not_money" | "caps_inverted" | "above_ceiling" | "bad_dates" | "too_long" | "bad_cadence";

/** The words of a mandate cannot be accepted. Asking again with the same words cannot help. */
export class MandateTermsError extends Error {
  readonly retryable = false;
  readonly reason: MandateTermsRefusal;

  constructor(reason: MandateTermsRefusal) {
    super(`A mandate cannot be granted: ${reason}`);
    this.name = "MandateTermsError";
    this.reason = reason;
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/**
 * Whether terms may be granted. Caps are hard: a mandate never lifts the
 * agreement's ceiling, a purchase never has more room than a period, and it
 * ends within a year.
 */
export function checkMandateTerms(terms: MandateTerms, ceilingCents: number): void {
  for (const value of [terms.perPurchaseCents, terms.perPeriodCents, ceilingCents]) assertCents(value);
  if (terms.perPurchaseCents <= 0 || terms.perPeriodCents <= 0) throw new MandateTermsError("not_money");
  if (terms.perPurchaseCents > terms.perPeriodCents) throw new MandateTermsError("caps_inverted");
  if (terms.perPurchaseCents > ceilingCents) throw new MandateTermsError("above_ceiling");
  if (!MANDATE_CADENCES.includes(terms.cadence)) throw new MandateTermsError("bad_cadence");
  if (!DAY.test(terms.validFrom) || !DAY.test(terms.expiresOn) || Number.isNaN(dayNumber(terms.validFrom)) || Number.isNaN(dayNumber(terms.expiresOn))) {
    throw new MandateTermsError("bad_dates");
  }
  const days = dayNumber(terms.expiresOn) - dayNumber(terms.validFrom);
  if (days <= 0) throw new MandateTermsError("bad_dates");
  if (days > MAX_MANDATE_DAYS) throw new MandateTermsError("too_long");
}

/**
 * How far a mandate's per-purchase cap reaches above what the parent usually
 * decides herself, in cents; 0 when it does not, or when she does not decide.
 * Such a mandate is only acceptable if she knowingly says yes ahead of time,
 * so the grant says it in words and the record shows it later. The threshold
 * test is the approval plan's own (`parentMustDecide`), not a copy.
 */
export function mandateExcessAboveParentLimit(terms: MandateTerms, parentLevel: ParentLevel, approvals: ApprovalTerms): number {
  assertCents(terms.perPurchaseCents);
  return parentMustDecide(terms.perPurchaseCents, parentLevel, approvals) ? terms.perPurchaseCents - approvals.parentDecidesAboveCents : 0;
}

export type MandateRefusal =
  | "not_active"
  | "paused"
  | "not_started"
  | "expired"
  | "circle_paused"
  | "out_of_scope"
  | "above_per_purchase"
  | "over_period"
  | "already_used_this_period";

/** The cart Kin built from a refill rule: which rule it buys under and what it totals now. */
export type MandateCart = { readonly ruleId: string; readonly totalCents: number };

export type MandateCandidate = {
  readonly mandate: Mandate;
  /** The circle's calendar day. */
  readonly today: string;
  readonly circlePaused: boolean;
  /** What this mandate's purchases cost this period, counting those still waiting. */
  readonly usedCents: number;
  readonly usedCount: number;
};

/**
 * Whether a cart fits a mandate, as the first reason it does not or `null`.
 * Pure: the caller passes the day and the period's use. Every limit is
 * checked, so a refill that fits none of them never runs without a live yes.
 */
export function checkMandate(candidate: MandateCandidate, cart: MandateCart): MandateRefusal | null {
  const { mandate, today, circlePaused, usedCents, usedCount } = candidate;
  for (const value of [cart.totalCents, usedCents, mandate.perPurchaseCents, mandate.perPeriodCents]) assertCents(value);
  if (mandate.status === "revoked") return "not_active";
  if (mandate.status === "paused") return "paused";
  if (today < mandate.validFrom) return "not_started";
  if (today > mandate.expiresOn) return "expired";
  if (circlePaused) return "circle_paused";
  if (cart.ruleId !== mandate.ruleId) return "out_of_scope";
  if (cart.totalCents > mandate.perPurchaseCents) return "above_per_purchase";
  if (mandate.cadence === "monthly" && usedCount > 0) return "already_used_this_period";
  if (usedCents + cart.totalCents > mandate.perPeriodCents) return "over_period";
  return null;
}

export type MandateDecision =
  | { readonly outcome: "covered"; readonly mandateId: string }
  | { readonly outcome: "ask_parent"; readonly mandateId: string; readonly reason: MandateRefusal };

/**
 * Decides among the mandates that could cover a cart: the first that fits
 * approves it, and otherwise the parent is asked and told why the nearest one
 * did not fit. `null` means no live mandate exists for the cart at all.
 */
export function decideMandate(candidates: readonly MandateCandidate[], cart: MandateCart): MandateDecision | null {
  let asked: MandateDecision | null = null;
  for (const candidate of candidates) {
    const reason = checkMandate(candidate, cart);
    if (reason === null) return { outcome: "covered", mandateId: candidate.mandate.mandateId };
    if (candidate.mandate.status === "revoked" || candidate.mandate.ruleId !== cart.ruleId) continue;
    asked ??= { outcome: "ask_parent", mandateId: candidate.mandate.mandateId, reason };
  }
  return asked;
}
