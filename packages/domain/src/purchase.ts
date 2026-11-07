import type { Agreement } from "./agreement.ts";
import { planApprovals, type ApprovalPlan, type Payee } from "./approval-plan.ts";
import { assertCents } from "./money.ts";
import type { ParentLevel } from "./roles.ts";

/** The purpose key every proposal raised from a refill rule carries. */
export const REFILL_PURPOSE = "refill";

/**
 * What the family allowed Kin to buy, and from whom (docs/architecture.md
 * section 8.6): one seller, one kind of thing, a limit for each purchase and
 * a budget for the month. Kin can only propose what fits it.
 */
export type PurchaseRule = {
  readonly ruleId: string;
  readonly seller: { readonly payeeId: string; readonly approved: boolean };
  readonly category: string;
  /** What the seller charges for one refill now, in the circle's currency. */
  readonly priceCents: number;
  /** The most one purchase under this rule may cost. */
  readonly limitCents: number;
  /** The most the rule may spend in one calendar month. */
  readonly monthlyBudgetCents: number;
};

export type PurchaseRefusal = "seller_not_approved" | "above_limit" | "over_budget";

/** The refill does not fit the family's rule. Asking again cannot help. */
export class PurchaseError extends Error {
  readonly retryable = false;
  readonly reason: PurchaseRefusal;

  constructor(reason: PurchaseRefusal) {
    super(`A purchase does not fit its rule: ${reason}`);
    this.name = "PurchaseError";
    this.reason = reason;
  }
}

/**
 * Whether one refill fits its rule, as the refusal or `null`. Plain code
 * decides this, never the model. `committedCents` is what this rule's
 * purchases already cost this month, counting those still waiting for a yes.
 */
export function checkPurchase(rule: PurchaseRule, committedCents: number): PurchaseRefusal | null {
  for (const value of [rule.priceCents, rule.limitCents, rule.monthlyBudgetCents, committedCents]) assertCents(value);
  if (!rule.seller.approved) return "seller_not_approved";
  if (rule.priceCents > rule.limitCents) return "above_limit";
  if (committedCents + rule.priceCents > rule.monthlyBudgetCents) return "over_budget";
  return null;
}

export type PurchaseRequest = {
  readonly rule: PurchaseRule;
  readonly committedCents: number;
  readonly payee: Payee;
  readonly agreement: Pick<Agreement, "version" | "approvals">;
  readonly parentLevel: ParentLevel;
  readonly pausedUntil: Date | null;
  readonly now: Date;
};

export type PurchasePlan = { readonly cents: number; readonly plan: ApprovalPlan };

/**
 * Who must say yes before a refill is bought. The amount is the rule's own
 * price, so no one types it, and a purchase is never paid on a standing rule:
 * the parent or the family confirms each one.
 */
export function planPurchase(request: PurchaseRequest): PurchasePlan {
  const refusal = checkPurchase(request.rule, request.committedCents);
  if (refusal !== null) throw new PurchaseError(refusal);
  const plan = planApprovals({
    kind: "purchase",
    cents: request.rule.priceCents,
    payee: request.payee,
    agreement: request.agreement,
    parentLevel: request.parentLevel,
    pausedUntil: request.pausedUntil,
    now: request.now,
  });
  return { cents: request.rule.priceCents, plan };
}

/** Where an order stands on its way to the door, from docs/architecture.md section 8.6. */
export const DELIVERY_TRANSITIONS = {
  awaiting: ["ordered"],
  ordered: ["shipped"],
  shipped: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type DeliveryState = keyof typeof DELIVERY_TRANSITIONS;

/** Seconds after the order was placed at which the demo pharmacy reaches each step. */
export const DELIVERY_SCHEDULE_SECONDS = { shipped: 30, out_for_delivery: 90, delivered: 180 } as const;

/**
 * Where the demo pharmacy's order has got to `seconds` after it was placed.
 * A schedule rather than a carrier, and labelled as simulated where shown.
 */
export function deliveryStateAfter(seconds: number): Exclude<DeliveryState, "awaiting"> {
  if (seconds >= DELIVERY_SCHEDULE_SECONDS.delivered) return "delivered";
  if (seconds >= DELIVERY_SCHEDULE_SECONDS.out_for_delivery) return "out_for_delivery";
  if (seconds >= DELIVERY_SCHEDULE_SECONDS.shipped) return "shipped";
  return "ordered";
}

/** The next step on the way to the door, or `null` once delivered. */
export function nextDeliveryState(state: DeliveryState): DeliveryState | null {
  return DELIVERY_TRANSITIONS[state][0] ?? null;
}
