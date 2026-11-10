import { describe, expect, it } from "vitest";

import { refundContribution, type ContributionRefund } from "./contribution-refund.ts";
import { FEES, POOL_CASH, memberAccount } from "./ledger-accounts.ts";
import { accountBalance, accountBalances, appendEntries, appendEntry, openLedger, type Ledger } from "./ledger.ts";
import { contributionReceived, payoutConfirmed } from "./postings.ts";
import { forAll } from "./testing/property.ts";
import { TEST_CIRCLE, TEST_CURRENCY, testHeader } from "./testing/entries.ts";
import { auditLedger } from "./verify-ledger.ts";

const usd = (cents: number) => ({ cents, currency: TEST_CURRENCY });
const correction = { id: "entry-refund", occurredOn: "2026-11-10", period: "2026-11", description: "Top-up refunded through PayPal" };

/** Marcus's $25.00 top-up, PayPal's fee 52 cents, captured as CAPTURE1. */
function ledgerWithTopUp(grossCents = 2500, feeCents = 52): Ledger {
  const topUp = contributionReceived(testHeader("CAPTURE1", { simulated: false }), { memberId: "marcus", grossCents, feeCents });
  return appendEntries(openLedger(TEST_CIRCLE, TEST_CURRENCY), [topUp]);
}

function fullRefund(overrides: Partial<ContributionRefund> = {}): ContributionRefund {
  return {
    captureId: "CAPTURE1",
    refundId: "REFUND1",
    completed: true,
    wholeCaptureRefunded: true,
    refunded: usd(2500),
    feeReturned: usd(52),
    net: usd(2448),
    totalRefunded: usd(2500),
    ...overrides,
  };
}

describe("a refund of a member's top-up", () => {
  it("is one reversing entry that names the contribution, so the member, the pool and the fees return to what they were", () => {
    const ledger = ledgerWithTopUp();
    const decision = refundContribution(ledger, fullRefund(), correction);
    if (decision.outcome !== "reverse") throw new Error(`Expected a reversal, got ${decision.outcome}`);
    const original = ledger.entries[0];
    expect(decision.entry).toMatchObject({ kind: "contribution", reverses: original?.id, source: { type: "paypal_event", id: "REFUND1" }, simulated: false, period: "2026-11" });

    const after = appendEntry(ledger, decision.entry).ledger;
    expect(accountBalance(after, memberAccount("marcus"))).toBe(0);
    expect(accountBalance(after, POOL_CASH)).toBe(0);
    expect(accountBalance(after, FEES)).toBe(0);
    expect(auditLedger(TEST_CIRCLE, TEST_CURRENCY, after.entries).problems).toEqual([]);
  });

  it("is written once: the same refund again, or a reversal of the same capture, finds it there", () => {
    const ledger = ledgerWithTopUp();
    const decision = refundContribution(ledger, fullRefund(), correction);
    if (decision.outcome !== "reverse") throw new Error("Expected a reversal");
    const after = appendEntry(ledger, decision.entry).ledger;
    expect(refundContribution(after, fullRefund(), { ...correction, id: "entry-again" })).toEqual({ outcome: "already_reversed" });
    expect(refundContribution(after, fullRefund({ refundId: "REVERSAL2" }), { ...correction, id: "entry-again" })).toEqual({ outcome: "already_reversed" });
  });

  it("is held when no contribution came from the capture", () => {
    expect(refundContribution(ledgerWithTopUp(), fullRefund({ captureId: "CAPTURE9" }), correction)).toEqual({ outcome: "held", reason: "unknown_capture" });
    const payout = payoutConfirmed(testHeader("CAPTURE2"), { payeeId: "amara", cents: 100, feeCents: 0 });
    const ledger = appendEntries(ledgerWithTopUp(), [payout]);
    expect(refundContribution(ledger, fullRefund({ captureId: "CAPTURE2" }), correction)).toEqual({ outcome: "held", reason: "unknown_capture" });
  });

  it("is held, not approximated, for a part of the capture or the last of several parts", () => {
    const ledger = ledgerWithTopUp();
    const part = fullRefund({ wholeCaptureRefunded: false, refunded: usd(1000), feeReturned: usd(0), net: usd(1000), totalRefunded: usd(1000) });
    expect(refundContribution(ledger, part, correction)).toEqual({ outcome: "held", reason: "partial_refund" });
    const lastPart = fullRefund({ refunded: usd(1500), feeReturned: usd(52), net: usd(1448), totalRefunded: usd(2500) });
    expect(refundContribution(ledger, lastPart, correction)).toEqual({ outcome: "held", reason: "partial_refund" });
    expect(refundContribution(ledger, fullRefund({ wholeCaptureRefunded: false }), correction)).toEqual({ outcome: "held", reason: "partial_refund" });
  });

  it("is held when PayPal kept some of the fee, since a mirror would read more in the pool than PayPal holds", () => {
    const kept = fullRefund({ feeReturned: usd(0), net: usd(2500) });
    expect(refundContribution(ledgerWithTopUp(), kept, correction)).toEqual({ outcome: "held", reason: "fee_differs" });
    // With no fee on the capture, PayPal has none to keep.
    expect(refundContribution(ledgerWithTopUp(2500, 0), kept, correction)).toMatchObject({ outcome: "reverse" });
  });

  it("is held while PayPal has not finished it, or when its amounts do not add up or are in another currency", () => {
    const ledger = ledgerWithTopUp();
    expect(refundContribution(ledger, fullRefund({ completed: false }), correction)).toEqual({ outcome: "held", reason: "not_completed" });
    expect(refundContribution(ledger, fullRefund({ net: usd(2348) }), correction)).toEqual({ outcome: "held", reason: "breakdown" });
    expect(refundContribution(ledger, fullRefund({ feeReturned: { cents: 52, currency: "EUR" } }), correction)).toEqual({ outcome: "held", reason: "currency" });
  });

  it("only ever writes an entry that returns the pool by exactly what left PayPal, for any top-up and fee", () => {
    forAll(
      (random) => {
        const grossCents = random.int(1, 500_000);
        const feeCents = random.int(0, grossCents - 1);
        return { grossCents, feeCents, feeReturned: random.pick([feeCents, 0, random.int(0, feeCents)]), whole: random.int(0, 3) > 0, part: random.int(1, grossCents) };
      },
      ({ grossCents, feeCents, feeReturned, whole, part }) => {
        const ledger = ledgerWithTopUp(grossCents, feeCents);
        const refunded = whole ? grossCents : part;
        const refund = fullRefund({ wholeCaptureRefunded: whole, refunded: usd(refunded), feeReturned: usd(feeReturned), net: usd(refunded - feeReturned), totalRefunded: usd(refunded) });
        const decision = refundContribution(ledger, refund, correction);
        if (decision.outcome !== "reverse") return;
        const after = appendEntry(ledger, decision.entry).ledger;
        // What left the pool's PayPal balance is the refund less the fee PayPal gave back.
        expect(accountBalance(ledger, POOL_CASH) - accountBalance(after, POOL_CASH)).toBe(refunded - feeReturned);
        expect(accountBalance(after, memberAccount("marcus"))).toBe(0);
        expect([...accountBalances(after).values()].every((cents) => cents === 0)).toBe(true);
      },
    );
  });
});
