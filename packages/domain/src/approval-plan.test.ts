import { describe, expect, it } from "vitest";

import { ApprovalError } from "./approval-error.ts";
import {
  APPROVAL_WINDOW_HOURS,
  planApprovals,
  type ApprovalPlan,
  type Payee,
} from "./approval-plan.ts";
import { InvalidMoneyError } from "./money.ts";
import { pauseEndsAt } from "./pause.ts";
import {
  KNOWN_BILLER,
  NOW,
  TERMS,
  approvalRequest,
  randomApprovalRequest,
} from "./testing/approvals.ts";
import { forAll } from "./testing/property.ts";

const ELECTRICITY: Payee = {
  status: "approved",
  member: null,
  autoPay: { ruleId: "electricity", minCents: 5000, maxCents: 12000 },
};

const reasonsOf = (plan: ApprovalPlan) =>
  plan.outcome === "needs_approval"
    ? plan.slots.map((slot) => slot.reason)
    : plan.outcome;

describe("planApprovals, rule by rule", () => {
  describe("1. pause", () => {
    it("approves nothing while the circle is paused", () => {
      const until = pauseEndsAt(NOW);
      expect(planApprovals(approvalRequest({ pausedUntil: until }))).toEqual({
        outcome: "paused",
        until,
      });
    });

    it("holds even a payment a standing rule would make", () => {
      const plan = planApprovals(
        approvalRequest({ payee: ELECTRICITY, pausedUntil: pauseEndsAt(NOW) }),
      );
      expect(plan.outcome).toBe("paused");
    });

    it("holds an amount above the ceiling as paused, not refused", () => {
      const plan = planApprovals(
        approvalRequest({ cents: TERMS.ceilingCents + 1, pausedUntil: pauseEndsAt(NOW) }),
      );
      expect(plan.outcome).toBe("paused");
    });

    it("plans normally once the pause has lifted", () => {
      const plan = planApprovals(approvalRequest({ pausedUntil: NOW }));
      expect(plan.outcome).toBe("needs_approval");
    });
  });

  describe("2. hard limits", () => {
    it("refuses an amount above the ceiling, whoever asks", () => {
      expect(
        planApprovals(approvalRequest({ cents: TERMS.ceilingCents + 1 })),
      ).toEqual({ outcome: "refused", reason: "above_ceiling" });
    });

    it("accepts an amount at the ceiling", () => {
      const plan = planApprovals(approvalRequest({ cents: TERMS.ceilingCents }));
      expect(plan.outcome).toBe("needs_approval");
    });

    it("refuses above the ceiling even when a standing rule would cover it", () => {
      const plan = planApprovals(
        approvalRequest({
          cents: TERMS.ceilingCents + 1,
          payee: { ...ELECTRICITY, autoPay: { ruleId: "wide", minCents: 0, maxCents: 10_000_000 } },
        }),
      );
      expect(plan.outcome).toBe("refused");
    });
  });

  describe("3. auto-pay", () => {
    it("pays a known bill inside its expected range on the standing rule", () => {
      expect(planApprovals(approvalRequest({ payee: ELECTRICITY }))).toEqual({
        outcome: "standing_rule",
        ruleId: "electricity",
        agreementVersion: 4,
      });
    });

    it("includes both ends of the expected range", () => {
      for (const cents of [5000, 12000]) {
        expect(planApprovals(approvalRequest({ cents, payee: ELECTRICITY })).outcome).toBe(
          "standing_rule",
        );
      }
    });

    it("asks a person when the bill is outside the expected range", () => {
      for (const cents of [4999, 12001]) {
        expect(planApprovals(approvalRequest({ cents, payee: ELECTRICITY })).outcome).toBe(
          "needs_approval",
        );
      }
    });

    it("applies only to bills, never to purchases or payouts", () => {
      for (const kind of ["purchase", "caregiver_payout"] as const) {
        expect(planApprovals(approvalRequest({ kind, payee: ELECTRICITY })).outcome).toBe(
          "needs_approval",
        );
      }
    });

    it("needs no parent or second approval when the rule applies", () => {
      const plan = planApprovals(
        approvalRequest({
          cents: 60000,
          parentLevel: "decides",
          payee: { ...ELECTRICITY, autoPay: { ruleId: "rent", minCents: 55000, maxCents: 65000 } },
        }),
      );
      expect(plan.outcome).toBe("standing_rule");
    });
  });

  describe("4. the parent's decisions", () => {
    it("asks a parent who decides about an amount above their threshold", () => {
      const plan = planApprovals(
        approvalRequest({ kind: "purchase", cents: TERMS.parentDecidesAboveCents + 1, parentLevel: "decides" }),
      );
      expect(reasonsOf(plan)).toEqual(["parent_decides"]);
    });

    it("leaves an amount at the threshold to the organizer", () => {
      const plan = planApprovals(
        approvalRequest({ cents: TERMS.parentDecidesAboveCents, parentLevel: "decides" }),
      );
      expect(reasonsOf(plan)).toEqual(["organizer"]);
    });

    it("does not ask a parent who is informed or represented", () => {
      for (const parentLevel of ["informed", "represented"] as const) {
        expect(reasonsOf(planApprovals(approvalRequest({ cents: 9000, parentLevel })))).toEqual([
          "organizer",
        ]);
      }
    });

    it("asks only a member holding the parent role", () => {
      const plan = planApprovals(approvalRequest({ cents: 9000, parentLevel: "decides" }));
      expect(plan).toMatchObject({ slots: [{ roles: ["parent"] }] });
    });
  });

  describe("5. organizer approval", () => {
    it("asks an organizer for everything else", () => {
      const plan = planApprovals(approvalRequest());
      expect(plan).toMatchObject({
        outcome: "needs_approval",
        slots: [{ reason: "organizer", roles: ["organizer"] }],
      });
    });
  });

  describe("6. second approval", () => {
    it("asks a second member above the large-payment threshold", () => {
      const plan = planApprovals(
        approvalRequest({ cents: TERMS.secondApprovalAboveCents + 1 }),
      );
      expect(plan).toMatchObject({
        slots: [
          { reason: "organizer" },
          { reason: "second_approval", roles: ["organizer", "contributor"] },
        ],
      });
    });

    it("asks one member at the threshold", () => {
      const plan = planApprovals(approvalRequest({ cents: TERMS.secondApprovalAboveCents }));
      expect(reasonsOf(plan)).toEqual(["organizer"]);
    });

    it("pairs a second member with a parent who decides", () => {
      const plan = planApprovals(approvalRequest({ cents: 60000, parentLevel: "decides" }));
      expect(reasonsOf(plan)).toEqual(["parent_decides", "second_approval"]);
    });
  });

  describe("7. no self-approval", () => {
    it("names the member being paid, so the tally can require someone else", () => {
      const plan = planApprovals(
        approvalRequest({
          kind: "member_payout",
          cents: 12600,
          payee: { status: "approved", member: { memberId: "elena", role: "organizer" }, autoPay: null },
        }),
      );
      expect(plan).toMatchObject({ payeeMemberId: "elena" });
    });

    it("names no one when the payee is not a member", () => {
      expect(planApprovals(approvalRequest())).toMatchObject({ payeeMemberId: null });
    });
  });

  describe("8. new payees", () => {
    it("needs a person and tells the whole circle", () => {
      const plan = planApprovals(
        approvalRequest({ payee: { ...ELECTRICITY, status: "new" } }),
      );
      expect(plan).toMatchObject({ outcome: "needs_approval", announceToCircle: true });
    });

    it("does not announce a payee the circle already approved", () => {
      expect(planApprovals(approvalRequest())).toMatchObject({ announceToCircle: false });
    });
  });

  it("gives a proposal 72 hours to gather its approvals", () => {
    expect(APPROVAL_WINDOW_HOURS).toBe(72);
    expect(planApprovals(approvalRequest())).toMatchObject({
      expiresAt: new Date("2026-10-17T12:00:00Z"),
    });
  });
});

describe("planApprovals refuses facts it cannot judge", () => {
  it.each([0, -100])("an amount of %i", (cents) => {
    expect(() => planApprovals(approvalRequest({ cents }))).toThrow(ApprovalError);
  });

  it.each([10.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])("a non-integer amount %d", (cents) => {
    expect(() => planApprovals(approvalRequest({ cents }))).toThrow(InvalidMoneyError);
  });

  it("a negative or fractional limit", () => {
    for (const approvals of [
      { ...TERMS, ceilingCents: -1 },
      { ...TERMS, secondApprovalAboveCents: -1 },
      { ...TERMS, parentDecidesAboveCents: 0.5 },
    ]) {
      expect(() =>
        planApprovals(approvalRequest({ agreement: { version: 1, approvals } })),
      ).toThrow(Error);
    }
  });

  it("a member payout that names no member", () => {
    expect(() =>
      planApprovals(approvalRequest({ kind: "member_payout", payee: KNOWN_BILLER })),
    ).toThrow(ApprovalError);
  });

  it("an auto-pay rule with no valid range", () => {
    for (const autoPay of [
      { ruleId: "inverted", minCents: 10, maxCents: 9 },
      { ruleId: "negative", minCents: -1, maxCents: 9 },
    ]) {
      expect(() =>
        planApprovals(approvalRequest({ payee: { ...ELECTRICITY, autoPay } })),
      ).toThrow(ApprovalError);
    }
  });
});

describe("planApprovals for any request", () => {
  const generate = randomApprovalRequest;
  const paused = (request: ReturnType<typeof generate>) =>
    request.pausedUntil !== null && request.now < request.pausedUntil;

  it("holds everything while paused", () => {
    forAll(generate, (request) => {
      expect(planApprovals(request).outcome === "paused").toBe(paused(request));
    });
  });

  it("refuses exactly the amounts above the ceiling", () => {
    forAll(generate, (request) => {
      if (paused(request)) return;
      expect(planApprovals(request).outcome === "refused").toBe(
        request.cents > request.agreement.approvals.ceilingCents,
      );
    });
  });

  it("uses a standing rule only for an approved payee's bill inside its range", () => {
    forAll(generate, (request) => {
      if (planApprovals(request).outcome !== "standing_rule") return;
      const { kind, cents, payee } = request;
      expect(kind).toBe("bill_payment");
      expect(payee.status).toBe("approved");
      expect(payee.autoPay).not.toBeNull();
      expect(cents).toBeGreaterThanOrEqual(payee.autoPay?.minCents ?? Infinity);
      expect(cents).toBeLessThanOrEqual(payee.autoPay?.maxCents ?? -Infinity);
    });
  });

  it("always asks at least one person, and a second above the threshold", () => {
    forAll(generate, (request) => {
      const plan = planApprovals(request);
      if (plan.outcome !== "needs_approval") return;
      const terms = request.agreement.approvals;
      const large = request.cents > terms.secondApprovalAboveCents;
      expect(plan.slots).toHaveLength(large ? 2 : 1);
      const parentAsked =
        request.parentLevel === "decides" && request.cents > terms.parentDecidesAboveCents;
      expect(plan.slots[0]?.reason).toBe(parentAsked ? "parent_decides" : "organizer");
      expect(plan.payeeMemberId).toBe(request.payee.member?.memberId ?? null);
      expect(plan.announceToCircle).toBe(request.payee.status === "new");
      expect(plan.expiresAt.getTime() - request.now.getTime()).toBe(
        APPROVAL_WINDOW_HOURS * 3_600_000,
      );
    });
  });

  it("never lets a new payee be paid without a person", () => {
    forAll(generate, (request) => {
      if (request.payee.status !== "new") return;
      expect(planApprovals(request).outcome).not.toBe("standing_rule");
    });
  });
});
