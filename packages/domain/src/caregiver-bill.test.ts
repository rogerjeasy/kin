import { describe, expect, it } from "vitest";

import { calculateCaregiverBill, CaregiverBillError } from "./caregiver-bill.ts";
import { forAll } from "./testing/property.ts";

const details = {
  version: 1,
  currency: "USD",
  rateCentsPerHour: 2200,
  visits: [{ date: "2026-10-01", minutes: 240 }, { date: "2026-10-03", minutes: 240 }, { date: "2026-10-05", minutes: 240 }],
};

describe("a caregiver's bill", () => {
  it("values three four-hour visits from the recorded rate", () => {
    const bill = calculateCaregiverBill(details, "2026-10-06");
    expect(bill.cents).toBe(26400);
    expect(bill.lines.map((line) => line.cents)).toEqual([8800, 8800, 8800]);
    expect(bill.details).toEqual(details);
  });

  it("rounds each day's charge once, then adds the whole cents", () => {
    const bill = calculateCaregiverBill({ ...details, rateCentsPerHour: 90, visits: [{ date: "2026-10-01", minutes: 1 }, { date: "2026-10-02", minutes: 1 }] });
    expect(bill.cents).toBe(4);
  });

  it("normalizes the visit order for comparison on retries", () => {
    expect(calculateCaregiverBill({ ...details, visits: details.visits.toReversed() }).details).toEqual(details);
  });

  it.each([
    null, {}, { ...details, version: 2 }, { ...details, currency: "usd" },
    { ...details, cents: 1 }, { ...details, visits: [] },
    { ...details, rateCentsPerHour: 0 }, { ...details, rateCentsPerHour: 22.5 },
    { ...details, visits: [{ date: "2026-02-30", minutes: 60 }] },
    { ...details, visits: [{ date: "2026-10-01", minutes: 0 }] },
    { ...details, visits: [{ date: "2026-10-01", minutes: 1441 }] },
    { ...details, visits: [{ date: "2026-10-01", minutes: 1.5 }] },
    { ...details, visits: [{ date: "2026-10-01", minutes: 60, cents: 1 }] },
    { ...details, visits: [details.visits[0], details.visits[0]] },
    { ...details, rateCentsPerHour: 1, visits: [{ date: "2026-10-01", minutes: 1 }] },
    { ...details, rateCentsPerHour: Number.MAX_SAFE_INTEGER, visits: [{ date: "2026-10-01", minutes: 1440 }] },
  ])("refuses malformed, ambiguous or unrepresentable billing details: %j", (input) => {
    expect(() => calculateCaregiverBill(input)).toThrow(CaregiverBillError);
  });

  it("refuses a future service date on the supplied circle calendar", () => {
    expect(() => calculateCaregiverBill(details, "2026-10-04")).toThrow(expect.objectContaining({ reason: "future" }));
    expect(calculateCaregiverBill(details, "2026-10-05").cents).toBe(26400);
  });

  it("keeps exact whole-hour totals and visit order cannot change the amount", () => {
    forAll((random) => ({ hours: random.int(1, 24), rate: random.int(1, 100000), days: random.int(1, 28) }), ({ hours, rate, days }) => {
      const visits = Array.from({ length: days }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, minutes: hours * 60 }));
      expect(calculateCaregiverBill({ ...details, rateCentsPerHour: rate, visits }).cents).toBe(hours * rate * days);
      expect(calculateCaregiverBill({ ...details, rateCentsPerHour: rate, visits: visits.toReversed() }).cents).toBe(hours * rate * days);
    });
  });
});
