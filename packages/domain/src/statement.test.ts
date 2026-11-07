import { describe, expect, it } from "vitest";

import { rosesMonth } from "./examples/roses-month.ts";
import { reverseEntry } from "./ledger-entry.ts";
import { appendEntry } from "./ledger.ts";
import { sumCents } from "./money.ts";
import { monthlyStatement, yearInReview } from "./statement.ts";

const { ledger } = rosesMonth;

describe("the monthly statement", () => {
  const statement = monthlyStatement({ ledger, period: "2026-10" });

  it("totals what members paid in, by member", () => {
    expect(statement.contributions.map((each) => each.subject).toSorted()).toEqual(["ana", "elena", "marcus"]);
    expect(statement.contributions.find((each) => each.subject === "marcus")?.cents).toBe(42400);
    expect(statement.contributedCents).toBe(sumCents(statement.contributions.map((each) => each.cents)));
  });

  it("reads the caregiver's confirmed pay from the payee's approved bill", () => {
    expect(statement.caregiverPay).toEqual([{ subject: "amara", cents: 26400 }]);
    expect(statement.caregiverPayCents).toBe(26400);
  });

  it("books spending by category, largest first, with caregiver pay inside it", () => {
    const sizes = statement.spending.map((each) => each.cents);
    expect(sizes).toEqual(sizes.toSorted((a, b) => b - a));
    expect(statement.spending.find((each) => each.subject === "care")?.cents).toBeGreaterThanOrEqual(26400);
    expect(statement.spentCents).toBe(sumCents(sizes));
  });

  it("counts a reversed entry as nothing", () => {
    const original = ledger.entries.find((entry) => entry.kind === "contribution" && entry.source.id === "sale-marcus");
    if (!original) throw new Error("no contribution");
    const reversal = reverseEntry(original, {
      id: "reversal-marcus",
      occurredOn: original.occurredOn,
      period: original.period,
      description: "refund",
      source: { type: "paypal_event", id: "refund-marcus" },
    });
    const result = appendEntry(ledger, reversal);
    const after = monthlyStatement({ ledger: result.ledger, period: "2026-10" });
    expect(after.contributions.find((each) => each.subject === "marcus")).toBeUndefined();
    expect(after.contributedCents).toBe(statement.contributedCents - 42400);
  });

  it("is empty for a month with no entries", () => {
    expect(monthlyStatement({ ledger, period: "2026-01" })).toMatchObject({ contributedCents: 0, spentCents: 0, entryCount: 0, contributions: [] });
  });
});

describe("the year in review", () => {
  const review = yearInReview({ ledger, year: "2026" });

  it("has twelve months, and the year is the sum of them", () => {
    expect(review.months).toHaveLength(12);
    expect(review.contributedCents).toBe(sumCents(review.months.map((each) => each.contributedCents)));
    expect(review.spentCents).toBe(sumCents(review.months.map((each) => each.spentCents)));
  });

  it("agrees with the month's statement for the month Rose's circle lives in", () => {
    const october = review.months.find((each) => each.period === "2026-10");
    const statement = monthlyStatement({ ledger, period: "2026-10" });
    expect(october).toMatchObject({ contributedCents: statement.contributedCents, spentCents: statement.spentCents });
  });

  it("lists who paid from their own pocket", () => {
    expect(review.ownPocket.find((each) => each.subject === "elena")?.cents).toBe(18000);
  });
});
