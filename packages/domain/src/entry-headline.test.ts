import { describe, expect, it } from "vitest";

import { entryHeadline } from "./entry-headline.ts";
import { rosesMonth } from "./examples/roses-month.ts";
import { LedgerError } from "./ledger-error.ts";

const bySource = (id: string) => {
  const entry = rosesMonth.ledger.entries.find((each) => each.source.id === id);
  if (!entry) throw new Error(`No entry from ${id}`);
  return entry;
};

describe("an entry's headline", () => {
  it("names the member and the gross amount of a contribution, and its fee", () => {
    expect(entryHeadline(bySource("sale-marcus"))).toEqual({ subject: "marcus", category: null, cents: 42400, feeCents: 1487, poolFlow: "in" });
  });

  it("names the payee of a confirmed payout, the amount paid and PayPal's fee", () => {
    expect(entryHeadline(bySource("payout-gas"))).toEqual({ subject: "gas", category: null, cents: 5700, feeCents: 25, poolFlow: "out" });
  });

  it("names the category of an approved bill, which moves no cash", () => {
    expect(entryHeadline(bySource("bill-water"))).toMatchObject({ subject: "water", category: "utilities", cents: 6100, poolFlow: "none" });
  });

  it("names the category of a purchase", () => {
    expect(entryHeadline(bySource("capture-refill"))).toMatchObject({ subject: "pharmacy", category: "pharmacy", cents: 4200, poolFlow: "out" });
  });

  it("values care in its memo account, outside the cash", () => {
    expect(entryHeadline(bySource("care-ana-5"))).toMatchObject({ subject: "ana", cents: 1500, poolFlow: "none" });
  });

  it("is found for every entry of Rose's month", () => {
    for (const entry of rosesMonth.ledger.entries) {
      expect(entryHeadline(entry).cents).toBeGreaterThan(0);
    }
  });

  it("is refused for an entry that names nothing it is about", () => {
    const entry = bySource("payout-gas");
    const stripped = { ...entry, kind: "contribution" as const };
    expect(() => entryHeadline(stripped)).toThrow(LedgerError);
  });
});
