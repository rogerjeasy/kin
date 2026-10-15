import { CARE_RECEIVED, rosesMonth, settlePeriod, sumCents } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { falseDemand } from "./claim-check";
import { roseHeard } from "./narrations";
import { amountFromSource, monthTotals, paidBills, recordEntries, spendingByCategory } from "./record";
import { upcomingBills } from "./upcoming";

describe("the record of Rose's month", () => {
  const entries = recordEntries();

  it("holds every ledger entry once, newest day first", () => {
    expect(entries).toHaveLength(rosesMonth.ledger.entries.length);
    expect(new Set(entries.map((view) => view.entry.id)).size).toBe(entries.length);
    const days = entries.map((view) => view.entry.occurredOn);
    expect(days).toEqual(days.toSorted().toReversed());
  });

  it("labels every entry as simulated, since no real PayPal transaction stands behind any", () => {
    expect(entries.every((view) => view.entry.simulated)).toBe(true);
  });

  it("names what each entry is about, with an amount above zero", () => {
    for (const view of entries) {
      expect(view.subject).not.toBe("");
      expect(view.cents).toBeGreaterThan(0);
    }
  });

  it("shows money in for contributions, money out for payments, and neither for approvals or care", () => {
    const flowOf = Object.fromEntries(entries.map((view) => [view.entry.kind, view.poolFlow]));

    expect(flowOf).toEqual({
      contribution: "in",
      payout_confirmed: "out",
      purchase_captured: "out",
      bill_approved: "none",
      out_of_pocket: "none",
      care_credit: "none",
    });
  });

  it("never counts care time as cash", () => {
    const care = entries.filter((view) => view.entry.kind === "care_credit");

    expect(care.length).toBeGreaterThan(0);
    for (const view of care) {
      expect(view.poolFlow).toBe("none");
      expect(view.entry.lines.some((line) => line.account === CARE_RECEIVED)).toBe(true);
    }
  });
});

describe("the month's totals", () => {
  const totals = monthTotals();

  it("leave in the pool exactly what came in, less what went out and PayPal's fees", () => {
    expect(totals.poolCents).toBe(totals.paidInCents - totals.paidOutCents - totals.feesCents);
  });

  it("are the figures Rose's story implies", () => {
    expect(totals).toEqual({ poolCents: 38218, paidInCents: 92400, paidOutCents: 50800, feesCents: 3382, entryCount: 19 });
  });

  it("split spending by category, largest first, adding up to every approved cost", () => {
    const spending = spendingByCategory();

    expect(spending.map((row) => row.category)).toEqual(["care", "pharmacy", "utilities"]);
    expect(sumCents(spending.map((row) => row.cents))).toBe(68800);
  });

  it("measure the same total contributed as the settlement, cash and own pocket and care", () => {
    const { fairness } = settlePeriod(rosesMonth);
    const care = sumCents(recordEntries().filter((view) => view.entry.kind === "care_credit").map((view) => view.cents));
    const ownPocket = sumCents(recordEntries().filter((view) => view.entry.kind === "out_of_pocket").map((view) => view.cents));

    expect(fairness.totalContributedCents).toBe(totals.paidInCents + ownPocket + care);
  });
});

describe("the paid bills", () => {
  it("are the four payouts PayPal confirmed, each approved on or before the day it was paid", () => {
    const bills = paidBills();

    expect(bills.map((bill) => bill.payeeId).toSorted()).toEqual(["amara", "electricity", "gas", "water"]);
    for (const bill of bills) {
      expect(bill.approvedOn !== null && bill.approvedOn <= bill.paidOn).toBe(true);
      expect(bill.feeCents).toBe(25);
    }
  });
});

describe("what Rose hears", () => {
  it("reads every amount from the ledger entry behind it", () => {
    const sources = { billPaid: "payout-electricity", refill: "capture-refill", letter: "bill-water", falseDemand: "payout-gas", caregiverPaid: "payout-amara" };

    for (const line of roseHeard()) {
      expect(line.cents).toBe(amountFromSource(sources[line.key]));
    }
  });

  it("is told about the false demand with the real gas payment it was checked against", () => {
    expect(falseDemand.lastPaid).toEqual({ cents: 5700, day: "2026-10-02" });
    expect(falseDemand.claimedCents).not.toBe(falseDemand.lastPaid.cents);
  });
});

describe("November's bills", () => {
  it("pay the utilities on their standing rules, and ask a person for the rest", () => {
    const outcomes = Object.fromEntries(upcomingBills().map((bill) => [bill.payeeId, bill.plan.outcome]));

    expect(outcomes).toEqual({ gas: "standing_rule", electricity: "standing_rule", amara: "needs_approval", pharmacy: "needs_approval" });
  });
});
