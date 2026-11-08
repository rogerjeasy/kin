import { describe, expect, it } from "vitest";

import { POOL_CASH } from "../ledger-accounts.ts";
import { accountBalance, appendEntries } from "../ledger.ts";
import {
  billApproved,
  settlementCollected,
  settlementPaidOut,
} from "../postings.ts";
import { settlePeriod } from "../settle-period.ts";
import { rosesMonth } from "./roses-month.ts";

const settlement = settlePeriod(rosesMonth);

describe("Rose's month", () => {
  it("is example data, marked simulated in every entry", () => {
    expect(rosesMonth.ledger.entries.every((entry) => entry.simulated)).toBe(true);
  });

  it("credits Elena's receipts and Ana's appointments", () => {
    expect(settlement.inputs.members).toEqual([
      expect.objectContaining({ memberId: "marcus", paidInCents: 42400 }),
      expect.objectContaining({
        memberId: "elena",
        paidInCents: 30000,
        outOfPocketCents: 18000,
      }),
      expect.objectContaining({
        memberId: "ana",
        paidInCents: 20000,
        careCreditCents: 7600,
      }),
    ]);
  });

  it("measures each sibling against 50, 30 and 20 percent", () => {
    expect(settlement.fairness.totalContributedCents).toBe(118000);
    expect(
      settlement.fairness.positions.map(({ memberId, targetCents, positionCents }) => ({
        memberId,
        targetCents,
        positionCents,
      })),
    ).toEqual([
      { memberId: "ana", targetCents: 23600, positionCents: 4000 },
      { memberId: "elena", targetCents: 35400, positionCents: 12600 },
      { memberId: "marcus", targetCents: 59000, positionCents: -16600 },
    ]);
  });

  it("owes Elena 126.00 and Ana 40.00, and asks Marcus for 166.00", () => {
    expect(settlement.plan).toEqual({
      currency: "USD",
      collections: [{ memberId: "marcus", cents: 16600 }],
      payouts: [
        { memberId: "ana", cents: 4000, feeReservedCents: 25, releasableCents: 4000 },
        { memberId: "elena", cents: 12600, feeReservedCents: 25, releasableCents: 12600 },
      ],
    });
  });

  it("leaves the pool holding what came in less fees and what went out", () => {
    // 924.00 in, 32.82 in fees on the way in, 508.00 in bills and the refill,
    // and 0.25 to send each of the four bills paid by payout.
    expect(accountBalance(rosesMonth.ledger, POOL_CASH)).toBe(36018);
  });

  it("returns the pool to its earlier balance, less the payout fees, once the settlement is paid", () => {
    const header = (name: string) => ({
      id: `settlement:${name}`,
      circleId: rosesMonth.ledger.circleId,
      occurredOn: "2026-11-02",
      period: "2026-11",
      description: name,
      source: { type: "settlement", id: name } as const,
      currency: rosesMonth.ledger.currency,
      simulated: true,
    });
    const settled = appendEntries(rosesMonth.ledger, [
      settlementCollected(header("collect-marcus"), {
        memberId: "marcus",
        grossCents: 16600,
        feeCents: 0,
      }),
      settlementPaidOut(header("pay-elena"), { memberId: "elena", cents: 12600, feeCents: 25 }),
      settlementPaidOut(header("pay-ana"), { memberId: "ana", cents: 4000, feeCents: 25 }),
    ]);

    expect(accountBalance(settled, POOL_CASH)).toBe(36018 - 50);
    expect(accountBalance(settled, "member:marcus")).toBe(59000);
    expect(accountBalance(settled, "member:elena")).toBe(35400);
    // Ana's 160.00 of cash plus her 76.00 of care make her 236.00 target.
    expect(accountBalance(settled, "member:ana")).toBe(16000);
    expect(accountBalance(settled, "care_credit:ana")).toBe(7600);
  });

  it("releases payouts only from cash not already promised to a bill", () => {
    // The stairlift repair of day 20, approved but not yet paid, leaves
    // 60.18 of the pool's 360.18 free, and 59.68 once the two payout fees
    // are held back.
    const withRepair = appendEntries(rosesMonth.ledger, [
      billApproved(
        {
          id: "approval:bill-stairlift",
          circleId: rosesMonth.ledger.circleId,
          occurredOn: "2026-10-20",
          period: rosesMonth.period,
          description: "Stairlift repair approved",
          source: { type: "approval", id: "bill-stairlift" },
          currency: rosesMonth.ledger.currency,
          simulated: true,
        },
        { payeeId: "stairlift", category: "repairs", cents: 30000 },
      ),
    ]);
    const { payouts } = settlePeriod({ ...rosesMonth, ledger: withRepair }).plan;

    expect(payouts.map((payout) => payout.cents)).toEqual([4000, 12600]);
    expect(
      payouts.reduce((sum, payout) => sum + payout.releasableCents, 0),
    ).toBe(5968);
  });
});
