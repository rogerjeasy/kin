import { describe, expect, it } from "vitest";

import {
  DELIVERY_SCHEDULE_SECONDS,
  DELIVERY_TRANSITIONS,
  PurchaseError,
  checkPurchase,
  deliveryStateAfter,
  nextDeliveryState,
  planPurchase,
  type PurchaseRule,
} from "./purchase.ts";
import { forAll } from "./testing/property.ts";

const RULE: PurchaseRule = {
  ruleId: "refill",
  seller: { payeeId: "pharmacy", approved: true },
  category: "pharmacy",
  priceCents: 6400,
  limitCents: 7500,
  monthlyBudgetCents: 15000,
};

const AGREEMENT = { version: 1, approvals: { ceilingCents: 300000, secondApprovalAboveCents: 50000, parentDecidesAboveCents: 5000 } };
const NOW = new Date("2026-10-30T18:00:00Z");
const request = (rule: PurchaseRule = RULE, committedCents = 0) => ({
  rule,
  committedCents,
  payee: { status: "approved" as const, member: null, autoPay: null },
  agreement: AGREEMENT,
  parentLevel: "decides" as const,
  pausedUntil: null,
  now: NOW,
});

describe("checkPurchase", () => {
  it("accepts a refill that fits its rule", () => {
    expect(checkPurchase(RULE, 0)).toBeNull();
    expect(checkPurchase(RULE, 15000 - 6400)).toBeNull();
  });

  it("refuses a seller the family has not approved, before anything else", () => {
    expect(checkPurchase({ ...RULE, seller: { payeeId: "pharmacy", approved: false }, priceCents: 99999 }, 0)).toBe("seller_not_approved");
  });

  it("refuses a price above the limit, and a month that would go over budget", () => {
    expect(checkPurchase({ ...RULE, priceCents: 7501 }, 0)).toBe("above_limit");
    expect(checkPurchase(RULE, 15000 - 6400 + 1)).toBe("over_budget");
  });

  it("holds for any price, limit, budget and spend: it accepts exactly what fits all three", () => {
    forAll(
      (random) => ({ priceCents: random.int(1, 20000), limitCents: random.int(1, 20000), monthlyBudgetCents: random.int(1, 40000), committedCents: random.int(0, 40000) }),
      ({ committedCents, ...terms }) => {
        const fits = terms.priceCents <= terms.limitCents && committedCents + terms.priceCents <= terms.monthlyBudgetCents;
        expect(checkPurchase({ ...RULE, ...terms }, committedCents) === null).toBe(fits);
      },
    );
  });
});

describe("planPurchase", () => {
  it("asks the parent for a refill above what she decides alone, and never on a standing rule", () => {
    const { cents, plan } = planPurchase(request());
    expect(cents).toBe(6400);
    expect(plan).toMatchObject({ outcome: "needs_approval", slots: [{ reason: "parent_decides", roles: ["parent"] }], payeeMemberId: null, announceToCircle: false });
  });

  it("asks the organizer for a small refill, and a second person for a large one", () => {
    expect(planPurchase(request({ ...RULE, priceCents: 4200 })).plan).toMatchObject({ slots: [{ reason: "organizer" }] });
    const large = planPurchase(request({ ...RULE, priceCents: 60000, limitCents: 60000, monthlyBudgetCents: 60000 }));
    expect(large.plan).toMatchObject({ slots: [{ reason: "parent_decides" }, { reason: "second_approval" }] });
  });

  it("refuses with the reason when the refill does not fit its rule", () => {
    expect(() => planPurchase(request(RULE, 15000))).toThrow(PurchaseError);
    expect(() => planPurchase(request({ ...RULE, priceCents: 9000 }))).toThrowError(expect.objectContaining({ reason: "above_limit" }));
  });

  it("holds while the circle is paused", () => {
    const until = new Date("2026-10-31T18:00:00Z");
    expect(planPurchase({ ...request(), pausedUntil: until }).plan).toEqual({ outcome: "paused", until });
  });
});

describe("delivery", () => {
  it("lists exactly the steps from the order's placing to the door, each once", () => {
    expect(Object.entries(DELIVERY_TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`))).toEqual([
      "awaiting>ordered",
      "ordered>shipped",
      "shipped>out_for_delivery",
      "out_for_delivery>delivered",
    ]);
    expect(nextDeliveryState("delivered")).toBeNull();
    expect(nextDeliveryState("ordered")).toBe("shipped");
  });

  it("reaches each step at its scheduled second and never goes back as time passes", () => {
    expect(deliveryStateAfter(0)).toBe("ordered");
    expect(deliveryStateAfter(DELIVERY_SCHEDULE_SECONDS.shipped - 1)).toBe("ordered");
    expect(deliveryStateAfter(DELIVERY_SCHEDULE_SECONDS.shipped)).toBe("shipped");
    expect(deliveryStateAfter(DELIVERY_SCHEDULE_SECONDS.out_for_delivery)).toBe("out_for_delivery");
    expect(deliveryStateAfter(DELIVERY_SCHEDULE_SECONDS.delivered)).toBe("delivered");
    const order = ["ordered", "shipped", "out_for_delivery", "delivered"];
    forAll(
      (random) => {
        const early = random.int(0, 400);
        return { early, late: early + random.int(0, 400) };
      },
      ({ early, late }) => expect(order.indexOf(deliveryStateAfter(late))).toBeGreaterThanOrEqual(order.indexOf(deliveryStateAfter(early))),
    );
  });
});
