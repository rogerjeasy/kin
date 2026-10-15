import { CARE_RECEIVED, rosesMonth, sumCents } from "@kin/domain";
import { snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { memberFairness, periodSettlement } from "./fairness";
import { openPeriod } from "./period";
import { monthTotals, paidBills, recordEntries, spendingByCategory } from "./record";
import { latestClaimCheck, parentHeard } from "./safety";
import { upcomingBills } from "./upcoming";

const db = testDatabases();
let circle: Awaited<ReturnType<typeof snapshotFor>>;
let ids: Awaited<ReturnType<typeof visitorWithCircle>>;

beforeAll(async () => {
  ids = await visitorWithCircle(db);
  circle = await snapshotFor(db, ids.userId, ids.circleId);
});

describe("the circle's record, as the organizer reads it", () => {
  it("holds every ledger entry once, newest day first", () => {
    const entries = recordEntries(circle);
    const days = entries.map((view) => view.entry.occurredOn);
    expect(entries).toHaveLength(rosesMonth.ledger.entries.length);
    expect(new Set(entries.map((view) => view.entry.id)).size).toBe(entries.length);
    expect(days).toEqual(days.toSorted().toReversed());
  });

  it("labels every entry of the demo circle as simulated", () => {
    expect(recordEntries(circle).every((view) => view.entry.simulated)).toBe(true);
  });

  it("never counts care time as cash", () => {
    const care = recordEntries(circle).filter((view) => view.entry.kind === "care_credit");
    expect(care).toHaveLength(4);
    for (const view of care) {
      expect(view.poolFlow).toBe("none");
      expect(view.entry.lines.some((line) => line.account === CARE_RECEIVED)).toBe(true);
    }
  });

  it("opens October on the demo clock, in the circle's timezone", () => {
    expect(openPeriod(circle)).toBe("2026-10");
  });
});

describe("the month's figures", () => {
  it("leave in the pool exactly what came in, less what went out and PayPal's fees", () => {
    const totals = monthTotals(circle, "2026-10");
    expect(totals.poolCents).toBe(totals.paidInCents - totals.paidOutCents - totals.feesCents);
  });

  it("are the figures Rose's story implies, read back from the database", () => {
    expect(monthTotals(circle, "2026-10")).toEqual({ poolCents: 38218, paidInCents: 92400, paidOutCents: 50800, feesCents: 3382, entryCount: 19 });
  });

  it("count nothing for a month the ledger has no entries in, but keep the pool", () => {
    expect(monthTotals(circle, "2026-11")).toEqual({ poolCents: 38218, paidInCents: 0, paidOutCents: 0, feesCents: 0, entryCount: 0 });
  });

  it("split spending by category, largest first, adding up to every approved cost", () => {
    const spending = spendingByCategory(circle, "2026-10");
    expect(spending.map((row) => row.category)).toEqual(["care", "pharmacy", "utilities"]);
    expect(sumCents(spending.map((row) => row.cents))).toBe(68800);
  });

  it("measure the same total contributed as the settlement, cash and own pocket and care", () => {
    const settlement = periodSettlement(circle, "2026-10");
    if (!settlement) throw new Error("The organizer sees the settlement");
    const members = memberFairness(settlement, circle);
    const ownPocket = sumCents(members.map((member) => member.input.outOfPocketCents));
    const care = sumCents(members.map((member) => member.input.careCreditCents));
    expect(settlement.fairness.totalContributedCents).toBe(92400 + ownPocket + care);
    expect(members.map((member) => [member.memberId, member.shareBps, member.shareIndex])).toEqual([
      [ids.members.marcus, 5000, 0],
      [ids.members.elena, 3000, 1],
      [ids.members.ana, 2000, 2],
    ]);
  });
});

describe("the bills", () => {
  it("paid are the four payouts PayPal confirmed, each approved on or before the day it was paid", () => {
    const bills = paidBills(circle);
    expect(bills.map((bill) => bill.payeeId).toSorted()).toEqual([ids.payees.amara, ids.payees.electricity, ids.payees.gas, ids.payees.water].toSorted());
    for (const bill of bills) {
      expect(bill.approvedOn !== null && bill.approvedOn <= bill.paidOn).toBe(true);
      expect(bill.feeCents).toBe(25);
      expect(bill.simulated).toBe(true);
    }
  });

  it("expected pay the utilities on their standing rules, and ask a person for the rest", () => {
    const outcomes = Object.fromEntries(upcomingBills(circle).map((bill) => [bill.payeeId, bill.plan?.outcome]));
    expect(outcomes).toEqual({
      [ids.payees.gas]: "standing_rule",
      [ids.payees.electricity]: "standing_rule",
      [ids.payees.amara]: "needs_approval",
      [ids.payees.pharmacy]: "needs_approval",
    });
  });
});

describe("what Rose heard, and the false demand", () => {
  it("reads every amount Rose heard from the ledger entry behind it, newest first", () => {
    const heard = parentHeard(circle);
    expect(heard.map((line) => [line.topic, line.cents])).toEqual([
      ["falseDemand", 5700],
      ["letter", 6100],
      ["refill", 4200],
      ["caregiverPaid", 26400],
      ["billPaid", 8400],
    ]);
  });

  it("checks the false demand against the real gas payment", () => {
    const check = latestClaimCheck(circle);
    expect(check?.lastPaid).toEqual({ cents: 5700, day: "2026-10-02" });
    expect(check?.claimedCents).toBe(30000);
    expect(check?.alerted).toEqual([ids.members.elena, ids.members.marcus]);
  });

  it("drops a narration whose amount disagrees with its entry, as the number guard requires", () => {
    const tampered = { ...circle, narrations: circle.narrations.map((narration) => ({ ...narration, cents: (narration.cents ?? 0) + 1 })) };
    expect(parentHeard(tampered)).toEqual([]);
  });
});
