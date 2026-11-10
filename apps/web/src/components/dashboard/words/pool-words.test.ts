import { describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/locales";
import { formatters } from "@/lib/format";

import { payoutReasonWords } from "./payout-reason-words";
import { feesNote, poolNote, poolSplit } from "./pool-words";

const format = formatters("en", "USD");

describe("the pool card's words", () => {
  it("say confirmed by PayPal only for PayPal's money", async () => {
    const { pool } = (await getDictionary("en")).dashboard.overview.stats;
    expect(poolNote(pool, { kind: "paypal", sandboxInCents: 0 }, format)).toBe("Confirmed by PayPal");
    expect(poolNote(pool, { kind: "simulated", sandboxInCents: 0 }, format)).toBe("Simulated money, in the demo");
    expect(poolNote(pool, { kind: "mixed", sandboxInCents: 5000 }, format)).toBe("Simulated history, with $50.00 of real PayPal sandbox top-ups");
  });

  it("say which figure the pool is: her Purse included, and what bills can draw on", async () => {
    const { pool } = (await getDictionary("en")).dashboard.overview.stats;
    expect(poolSplit(pool, { freeCents: 31018, purseCents: 5000 }, "Rose", format)).toBe("That includes $50.00 set aside in Rose’s Purse. Bills can draw on $310.18.");
    expect(poolSplit(pool, { freeCents: 31018, purseCents: 0 }, "Rose", format)).toBeNull();
  });

  it("call simulated fees simulated", async () => {
    const { paidOut } = (await getDictionary("en")).dashboard.overview.stats;
    expect(feesNote(paidOut, "paypal", "$33.82")).toBe("And $33.82 in PayPal fees");
    expect(feesNote(paidOut, "simulated", "$33.82")).toBe("And $33.82 in simulated PayPal fees");
    expect(feesNote(paidOut, "mixed", "$33.82")).toBe("And $33.82 in PayPal fees, some of them simulated");
  });
});

describe("why a settlement payout goes now or later", () => {
  it("gives Ana's line its reason, from the same figures the line shows", async () => {
    const { reasons } = (await getDictionary("en")).dashboard.fairness.settlement;
    expect(payoutReasonWords(reasons, { kind: "part", availableCents: 1120, restCents: 2905 }, "$10.95", format)).toBe(
      "The pool has $11.20 that bills have not claimed. With PayPal’s fee held back, $10.95 can go now; the other $29.05 goes once more money arrives.",
    );
  });

  it("is worded in every language for every reason", async () => {
    for (const locale of locales) {
      const { reasons } = (await getDictionary(locale)).dashboard.fairness.settlement;
      for (const kind of ["all", "part", "shared", "none"] as const) {
        expect(payoutReasonWords(reasons, { kind, availableCents: 1120, restCents: 2905 }, "$10.95", format)).toContain("$11.20");
      }
    }
  });
});
