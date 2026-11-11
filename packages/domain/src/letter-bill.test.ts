import { describe, expect, it } from "vitest";

import { BillReviewError, billRoute, checkBillReview, outsideReceiptCategory, planBillPayment, type BillPaymentRequest } from "./letter-bill.ts";
import { NOW, TERMS } from "./testing/approvals.ts";
import { forAll } from "./testing/property.ts";

const review = (overrides: Record<string, unknown> = {}) => checkBillReview({ name: "Lakeside Water", cents: 6_100, dueOn: "2026-11-30", receiver: null, ...overrides });
const request = (overrides: Partial<BillPaymentRequest> = {}): BillPaymentRequest => ({
  cents: 6_100,
  payeeStatus: "new",
  agreement: { version: 2, approvals: TERMS },
  parentLevel: "informed",
  pausedUntil: null,
  now: NOW,
  ...overrides,
});

describe("checkBillReview", () => {
  it("keeps what the person confirmed, trimmed, with the email in lower case", () => {
    expect(review({ name: "  Lakeside Water ", receiver: " Billing@Lakeside.Example " })).toEqual({ name: "Lakeside Water", cents: 6_100, dueOn: "2026-11-30", receiver: "billing@lakeside.example" });
  });

  it("takes no due day and no PayPal address as none", () => {
    expect(review({ dueOn: "", receiver: "" })).toMatchObject({ dueOn: null, receiver: null });
  });

  it.each([
    [{ name: " " }, "name"],
    [{ name: "x".repeat(81) }, "name"],
    [{ cents: 0 }, "amount"],
    [{ cents: 12.5 }, "amount"],
    [{ cents: "6100" }, "amount"],
    [{ dueOn: "2026-02-30" }, "due"],
    [{ dueOn: 20261130 }, "due"],
    [{ receiver: "not an email" }, "receiver"],
    [{ receiver: `${"a".repeat(120)}@example.com` }, "receiver"],
  ] as const)("refuses %j for its %s", (overrides, reason) => {
    expect(() => review(overrides)).toThrow(BillReviewError);
    expect(() => review(overrides)).toThrow(expect.objectContaining({ reason }));
  });
});

describe("billRoute", () => {
  it("pays through PayPal only when the payee has a PayPal address", () => {
    expect(billRoute({ receiver: "billing@lakeside.example" })).toBe("paypal");
    expect(billRoute({ receiver: null })).toBe("outside");
  });
});

describe("planBillPayment", () => {
  it("asks the organizer, and tells the whole circle about a new payee", () => {
    const plan = planBillPayment(request());
    expect(plan).toMatchObject({ outcome: "needs_approval", slots: [{ reason: "organizer" }], payeeMemberId: null, announceToCircle: true });
  });

  it("asks the parent above her threshold, and a second yes above the large-payment line", () => {
    const plan = planBillPayment(request({ cents: 60_000, parentLevel: "decides", payeeStatus: "approved" }));
    expect(plan).toMatchObject({ outcome: "needs_approval", slots: [{ reason: "parent_decides" }, { reason: "second_approval" }], announceToCircle: false });
  });

  it("refuses above the ceiling and plans nothing while paused", () => {
    expect(planBillPayment(request({ cents: TERMS.ceilingCents + 1 }))).toEqual({ outcome: "refused", reason: "above_ceiling" });
    const until = new Date(NOW.getTime() + 3_600_000);
    expect(planBillPayment(request({ pausedUntil: until }))).toEqual({ outcome: "paused", until });
  });

  it("never pays a reviewed bill on a standing rule, and never names a member being paid", () => {
    forAll(
      (random) => request({ cents: random.int(1, 400_000), payeeStatus: random.pick(["approved", "new"] as const), parentLevel: random.pick(["decides", "informed"] as const) }),
      (input) => {
        const plan = planBillPayment(input);
        expect(["needs_approval", "refused"]).toContain(plan.outcome);
        if (plan.outcome === "needs_approval") {
          expect(plan.payeeMemberId).toBeNull();
          expect(plan.slots.length).toBeGreaterThan(0);
          expect(plan.announceToCircle).toBe(input.payeeStatus === "new");
        }
      },
    );
  });
});

describe("outsideReceiptCategory", () => {
  it("credits a receipt under the payee's category when receipts know it, and under other when not", () => {
    expect(outsideReceiptCategory("pharmacy")).toBe("pharmacy");
    expect(outsideReceiptCategory("utilities")).toBe("other");
    expect(outsideReceiptCategory("other")).toBe("other");
  });
});
