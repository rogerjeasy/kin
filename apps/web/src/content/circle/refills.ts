import type { CircleSnapshot, PurchaseRecord, PurchaseRuleRecord } from "@kin/db";
import { DELIVERY_TRANSITIONS, isPaused, type DeliveryState } from "@kin/domain";

import { may } from "@/server/dashboard-context";
import { aboveUsualLimit } from "@/server/mandates";

export type RuleView = {
  readonly rule: PurchaseRuleRecord;
  /** What is left of the month's budget, never below zero. */
  readonly remainingCents: number;
  /** The viewer may ask Kin to reorder, nothing is paused, and no refill under this rule still waits. */
  readonly askable: boolean;
};

export type OrderView = {
  readonly purchase: PurchaseRecord;
  /** The proposal's own state: waiting for a yes, rejected and so on. */
  readonly proposalState: string;
  /** The parent's standing permission approved it, so no one was asked. */
  readonly viaMandate: boolean;
  /** Bought under a standing permission although it is more than the parent usually decides herself. */
  readonly aboveUsualLimit: boolean;
  /**
   * How it was paid, as its ledger entry says: through PayPal's sandbox, with PayPal's capture ID, or simulated.
   * `null` until it is bought (AGENTS.md section 5, rule 9).
   */
  readonly payment: OrderPayment | null;
};

export type OrderPayment = { readonly kind: "sandbox"; readonly captureId: string } | { readonly kind: "simulated" };

/** The ledger entry the purchase was recorded under decides whether real sandbox money stands behind it. */
function paymentOf(circle: CircleSnapshot, purchase: PurchaseRecord): OrderPayment | null {
  if (purchase.paidItemId === null) return null;
  const entry = circle.ledger.entries.find((each) => each.kind === "purchase_captured" && each.source.type === "paypal_event" && each.source.id === purchase.paidItemId);
  if (entry === undefined) return null;
  return entry.simulated ? { kind: "simulated" } : { kind: "sandbox", captureId: entry.source.id };
}

/** Whether any of the orders was paid through PayPal's sandbox, so the screen does not call every order simulated. */
export function anyPaidInSandbox(orders: readonly OrderView[]): boolean {
  return orders.some((order) => order.payment?.kind === "sandbox");
}

const WAITING: readonly string[] = ["pending_approval", "approved", "executing"];

/** Every refill rule of the circle as the viewer sees it, and the purchases raised from them, newest first. */
export function refillViews(circle: CircleSnapshot): { readonly rules: readonly RuleView[]; readonly orders: readonly OrderView[] } {
  const stateOf = new Map<string, string>(circle.proposals.map((proposal) => [proposal.id, proposal.state]));
  const orders = circle.purchases
    .map((purchase) => {
      const viaMandate = circle.proposals.some((proposal) => proposal.id === purchase.proposalId && proposal.votes.some((vote) => vote.method === "mandate"));
      return {
        purchase,
        proposalState: stateOf.get(purchase.proposalId) ?? "pending_approval",
        viaMandate,
        aboveUsualLimit: viaMandate && aboveUsualLimit(circle, purchase.cents),
        payment: paymentOf(circle, purchase),
      };
    })
    .toReversed();
  const mayAsk = may(circle, "refill.propose") && !isPaused(circle.circle.pausedUntil, circle.circle.now);
  const rules = circle.purchaseRules.map((rule) => ({
    rule,
    remainingCents: Math.max(0, rule.monthlyBudgetCents - rule.committedCents),
    askable: mayAsk && !orders.some((order) => order.purchase.ruleId === rule.id && WAITING.includes(order.proposalState)),
  }));
  return { rules, orders };
}

/** Whether any order is still on its way, so the screen keeps looking. */
export function anyOnTheWay(orders: readonly OrderView[]): boolean {
  return orders.some((order) => order.proposalState === "settled" && order.purchase.state !== "delivered");
}

/** The steps from the order's placing to the door, in order, without the one before it is placed. */
export const DELIVERY_STEPS: readonly DeliveryState[] = (Object.keys(DELIVERY_TRANSITIONS) as DeliveryState[]).filter((state) => state !== "awaiting");
