import { describe, expect, it } from "vitest";

import { checkMandate, checkMandateTerms, decideMandate, type Mandate, type MandateCandidate, type MandateCart } from "./mandate.ts";

const mandate: Mandate = { mandateId: "m1", status: "active", ruleId: "r1", perPurchaseCents: 5_000, perPeriodCents: 5_000, cadence: "monthly", validFrom: "2026-11-01", expiresOn: "2027-10-31" };
const cart: MandateCart = { ruleId: "r1", totalCents: 4_200 };
const base: MandateCandidate = { mandate, today: "2026-11-09", circlePaused: false, usedCents: 0, usedCount: 0 };
const candidate = (change: Partial<MandateCandidate>): MandateCandidate => ({ ...base, ...change });

describe("checkMandate", () => {
  it("passes a cart inside every limit", () => {
    expect(checkMandate(base, cart)).toBeNull();
  });

  it.each([
    ["a revoked mandate", candidate({ mandate: { ...mandate, status: "revoked" } }), cart, "not_active"],
    ["a paused mandate", candidate({ mandate: { ...mandate, status: "paused" } }), cart, "paused"],
    ["before it starts", candidate({ today: "2026-10-31" }), cart, "not_started"],
    ["after it expires", candidate({ today: "2027-11-01" }), cart, "expired"],
    ["while the circle is paused", candidate({ circlePaused: true }), cart, "circle_paused"],
    ["another rule's cart", base, { ruleId: "r2", totalCents: 4_200 }, "out_of_scope"],
    ["a price that rose to 58 dollars", base, { ruleId: "r1", totalCents: 5_800 }, "above_per_purchase"],
    ["a second purchase in a monthly period", candidate({ usedCents: 4_200, usedCount: 1, mandate: { ...mandate, perPeriodCents: 10_000 } }), cart, "already_used_this_period"],
    ["a period budget used up", candidate({ usedCents: 1_000 }), cart, "over_period"],
  ] as const)("refuses %s", (_name, check, aCart, reason) => {
    expect(checkMandate(check, aCart)).toBe(reason);
  });

  it("never lets a period total pass its cap, whatever the order of purchases", () => {
    const loose: Mandate = { ...mandate, cadence: "as_needed", perPurchaseCents: 3_000, perPeriodCents: 7_000 };
    let used = 0;
    for (let count = 0; count < 10; count += 1) {
      const refusal = checkMandate(candidate({ mandate: loose, usedCents: used, usedCount: count }), { ruleId: "r1", totalCents: 3_000 });
      if (refusal === null) used += 3_000;
      expect(used).toBeLessThanOrEqual(7_000);
    }
    expect(used).toBe(6_000);
  });

  it("refuses an amount that is not whole cents", () => {
    expect(() => checkMandate(base, { ruleId: "r1", totalCents: 41.5 })).toThrow();
  });
});

describe("decideMandate", () => {
  it("is covered by the first mandate that fits", () => {
    expect(decideMandate([base], cart)).toEqual({ outcome: "covered", mandateId: "m1" });
  });
  it("asks the parent, with the reason, when the mandate does not fit", () => {
    expect(decideMandate([base], { ruleId: "r1", totalCents: 5_800 })).toEqual({ outcome: "ask_parent", mandateId: "m1", reason: "above_per_purchase" });
  });
  it("says nothing when no live mandate covers the rule", () => {
    expect(decideMandate([], cart)).toBeNull();
    expect(decideMandate([candidate({ mandate: { ...mandate, status: "revoked" } })], cart)).toBeNull();
    expect(decideMandate([base], { ruleId: "r2", totalCents: 100 })).toBeNull();
  });
});

describe("checkMandateTerms", () => {
  const terms = { ruleId: "r1", perPurchaseCents: 5_000, perPeriodCents: 5_000, cadence: "monthly", validFrom: "2026-11-01", expiresOn: "2027-10-31" } as const;
  it("accepts terms within the ceiling and a year", () => {
    expect(() => checkMandateTerms(terms, 300_000)).not.toThrow();
  });
  it.each([
    [{ ...terms, perPurchaseCents: 0 }, 300_000, "not_money"],
    [{ ...terms, perPurchaseCents: 6_000 }, 300_000, "caps_inverted"],
    [terms, 4_000, "above_ceiling"],
    [{ ...terms, expiresOn: "2026-11-01" }, 300_000, "bad_dates"],
    [{ ...terms, expiresOn: "2028-01-01" }, 300_000, "too_long"],
  ] as const)("refuses %j", (bad, ceiling, reason) => {
    expect(() => checkMandateTerms(bad, ceiling)).toThrow(expect.objectContaining({ reason }));
  });
});
