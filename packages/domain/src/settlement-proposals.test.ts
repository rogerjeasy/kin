import { describe, expect, it } from "vitest";

import { calculateFairness } from "./fairness.ts";
import { planSettlementPayouts, SettlementProposalError, type SettlementPayoutRequest } from "./settlement-proposals.ts";
import type { Settlement } from "./settle-period.ts";
import { rosesMonth } from "./examples/roses-month.ts";
import { settlePeriod } from "./settle-period.ts";
import { planSettlement } from "./settlement.ts";
import { sumCents } from "./money.ts";
import { pauseEndsAt } from "./pause.ts";
import { NOW } from "./testing/approvals.ts";
import { randomFairnessInput } from "./testing/generators.ts";
import { forAll } from "./testing/property.ts";

const settlement = settlePeriod(rosesMonth);
const roles = new Map<string, "organizer" | "contributor" | "parent">([
  ["marcus", "contributor"],
  ["elena", "organizer"],
  ["ana", "contributor"],
]);
const request = (overrides: Partial<SettlementPayoutRequest> = {}): SettlementPayoutRequest => ({
  settlement,
  roles,
  agreement: rosesMonth.agreement,
  parentLevel: "decides",
  pausedUntil: null,
  now: NOW,
  ...overrides,
});

describe("planSettlementPayouts", () => {
  it("raises one payout for each member the month owes, for what the pool can pay now", () => {
    const payouts = planSettlementPayouts(request());
    expect(payouts.map((payout) => [payout.memberId, payout.cents]).toSorted()).toEqual([["ana", 4000], ["elena", 12600]]);
    for (const payout of payouts) {
      expect(payout.plan).toMatchObject({ outcome: "needs_approval", payeeMemberId: payout.memberId, announceToCircle: false });
    }
  });

  it("asks for the approvals the agreement asks for, and never lets the member paid be the only yes", () => {
    const [first] = planSettlementPayouts(request({ parentLevel: "informed" }));
    expect(first?.plan.slots[0]?.roles).toEqual(["organizer"]);
    expect(first?.plan.payeeMemberId).toBe(first?.memberId);
    // A deciding parent has the first say on anything above their threshold.
    const deciding = planSettlementPayouts(request({ parentLevel: "decides", agreement: { version: 1, approvals: { ceilingCents: 300_000, secondApprovalAboveCents: 50_000, parentDecidesAboveCents: 5_000 } } }));
    expect(deciding.find((payout) => payout.memberId === "elena")?.plan.slots[0]).toEqual({ reason: "parent_decides", roles: ["parent"] });
  });

  it("proposes only the part of a payout the pool can cover, and nothing at all when it holds nothing", () => {
    const short = (availableCents: number): Settlement => ({ ...settlement, plan: planSettlement(settlement.fairness, { availableCents, payoutFee: () => 25 }) });
    expect(planSettlementPayouts(request({ settlement: short(0) }))).toEqual([]);
    const partial = planSettlementPayouts(request({ settlement: short(5_000) }));
    expect(sumCents(partial.map((payout) => payout.cents))).toBeLessThanOrEqual(5_000 - 2 * 25);
  });

  it("is refused while the circle is paused, and for a payout above the agreement's ceiling", () => {
    expect(() => planSettlementPayouts(request({ pausedUntil: pauseEndsAt(NOW) }))).toThrow(SettlementProposalError);
    expect(() => planSettlementPayouts(request({ agreement: { version: 1, approvals: { ...rosesMonth.agreement.approvals, ceilingCents: 100 } } }))).toThrow(SettlementProposalError);
  });

  it("refuses to pay someone who is not a member of the circle", () => {
    expect(() => planSettlementPayouts(request({ roles: new Map() }))).toThrow(SettlementProposalError);
  });

  it("never proposes more than the cash that has arrived, nor more than a member is owed, for any month", () => {
    forAll(
      (random) => ({ input: randomFairnessInput(random), availableCents: random.pick([0, 500, 100_000, 10_000_000, 1_000_000_000]), fee: random.int(0, 500) }),
      ({ input, availableCents, fee }) => {
        const fairness = calculateFairness(input);
        const plan = planSettlement(fairness, { availableCents, payoutFee: () => fee });
        const month: Settlement = { period: "2026-10", agreementVersion: 1, inputs: input, fairness, plan };
        const members = new Map(input.members.map((member) => [member.memberId, "contributor" as const]));
        const payouts = planSettlementPayouts({
          settlement: month,
          roles: members,
          agreement: { version: 1, approvals: { ceilingCents: Number.MAX_SAFE_INTEGER, secondApprovalAboveCents: 50_000, parentDecidesAboveCents: 5_000 } },
          parentLevel: "informed",
          pausedUntil: null,
          now: NOW,
        });
        const owed = new Map(plan.payouts.map((payout) => [payout.memberId, payout.cents]));
        expect(sumCents(payouts.map((payout) => payout.cents))).toBeLessThanOrEqual(availableCents);
        for (const payout of payouts) {
          expect(payout.cents).toBeGreaterThan(0);
          expect(payout.cents).toBeLessThanOrEqual(owed.get(payout.memberId) ?? -1);
          expect(payout.plan.payeeMemberId).toBe(payout.memberId);
        }
      },
    );
  });
});
