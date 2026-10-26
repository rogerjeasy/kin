import { describe, expect, it } from "vitest";

import { decideApprovals } from "./approval-decision.ts";
import { planApprovals, type Payee } from "./approval-plan.ts";
import { calculateCaregiverBill } from "./caregiver-bill.ts";
import { CaregiverPayoutError, planCaregiverPayout, type CaregiverPayoutRequest } from "./caregiver-payout.ts";
import { forAll } from "./testing/property.ts";

const now = new Date("2026-10-30T18:00:00Z");
const details = {
  version: 1,
  currency: "USD",
  rateCentsPerHour: 2200,
  visits: [{ date: "2026-10-20", minutes: 240 }, { date: "2026-10-21", minutes: 240 }, { date: "2026-10-22", minutes: 240 }],
};
const amara: Payee = { status: "approved", member: { memberId: "amara", role: "caregiver" }, autoPay: null };
const request: CaregiverPayoutRequest = {
  details,
  billCents: 26_400,
  payee: amara,
  agreement: { version: 3, approvals: { ceilingCents: 300_000, secondApprovalAboveCents: 50_000, parentDecidesAboveCents: 5_000 } },
  parentLevel: "decides",
  pausedUntil: null,
  now,
};

describe("planning a caregiver's payout from their bill", () => {
  it("asks Rose for 264.00, above her 50.00, and names Amara as the member paid", () => {
    expect(planCaregiverPayout(request)).toEqual({
      cents: 26_400,
      plan: {
        outcome: "needs_approval",
        slots: [{ reason: "parent_decides", roles: ["parent"] }],
        payeeMemberId: "amara",
        announceToCircle: false,
        expiresAt: new Date("2026-11-02T18:00:00Z"),
      },
    });
  });

  it("refuses a stored amount that disagrees with the service days", () => {
    expect(() => planCaregiverPayout({ ...request, billCents: 26_401 })).toThrow(CaregiverPayoutError);
  });

  it("refuses a payee who is not a caregiver member of the circle", () => {
    for (const payee of [{ ...amara, member: null }, { ...amara, member: { memberId: "marcus", role: "contributor" as const } }]) {
      expect(() => planCaregiverPayout({ ...request, payee })).toThrow(expect.objectContaining({ reason: "not_a_caregiver" }));
    }
  });

  it("never pays a caregiver on a standing rule, even one that covers the amount", () => {
    const payee: Payee = { ...amara, autoPay: { ruleId: "rule-1", minCents: 1, maxCents: 1_000_000 } };
    expect(planCaregiverPayout({ ...request, payee }).plan.outcome).toBe("needs_approval");
  });

  it("says paused while the circle is paused, and refused above the ceiling", () => {
    expect(planCaregiverPayout({ ...request, pausedUntil: new Date(now.getTime() + 60_000) }).plan.outcome).toBe("paused");
    const ceiling = { ...request.agreement, approvals: { ...request.agreement.approvals, ceilingCents: 26_399 } };
    expect(planCaregiverPayout({ ...request, agreement: ceiling }).plan).toEqual({ outcome: "refused", reason: "above_ceiling" });
  });

  it("plans exactly what the approval engine plans for the evidence's own total, for any bill", () => {
    forAll(
      (random) => {
        const days = random.int(1, 20);
        const visits = Array.from({ length: days }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, minutes: random.int(1, 1440) }));
        const bill = { ...details, rateCentsPerHour: random.int(1, 20_000), visits };
        return {
          bill,
          parentLevel: random.pick(["decides", "informed", "represented"] as const),
          status: random.pick(["approved", "new"] as const),
          second: random.int(0, 200_000),
          parent: random.int(0, 200_000),
        };
      },
      ({ bill, parentLevel, status, second, parent }) => {
        const cents = calculateCaregiverBill(bill).cents;
        const agreement = { version: 1, approvals: { ceilingCents: Number.MAX_SAFE_INTEGER, secondApprovalAboveCents: second, parentDecidesAboveCents: parent } };
        const payee: Payee = { ...amara, status };
        const planned = planCaregiverPayout({ ...request, details: bill, billCents: cents, payee, agreement, parentLevel });
        expect(planned).toEqual({ cents, plan: planApprovals({ kind: "caregiver_payout", cents, payee, agreement, parentLevel, pausedUntil: null, now }) });
      },
    );
  });

  it("can never be approved by the caregiver alone, whatever the plan", () => {
    forAll(
      (random) => ({ second: random.int(0, 100_000), parent: random.int(0, 100_000), parentLevel: random.pick(["decides", "informed"] as const) }),
      ({ second, parent, parentLevel }) => {
        const agreement = { version: 1, approvals: { ceilingCents: 300_000, secondApprovalAboveCents: second, parentDecidesAboveCents: parent } };
        const { plan } = planCaregiverPayout({ ...request, agreement, parentLevel });
        if (plan.outcome !== "needs_approval") throw new Error("expected a plan that waits for approval");
        // Even if a caregiver's yes reached the tally, it could fill no place and make nothing independent.
        expect(decideApprovals({ plan, votes: [{ memberId: "amara", role: "caregiver", decision: "approve" }], pausedUntil: null, now })).toBe("pending");
      },
    );
  });
});
