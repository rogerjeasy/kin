import { describe, expect, it } from "vitest";

import { checkClaim, sameName, type ClaimFacts } from "./claim-check.ts";

const greenway = { id: "p-greenway", name: "Greenway Power Co" };
const facts = (overrides: Partial<ClaimFacts> = {}): ClaimFacts => ({
  claimedPayee: "Greenway Power",
  claimedCents: 8_640,
  payees: [greenway, { id: "p-amara", name: "Amara" }],
  bills: [],
  payments: [],
  ...overrides,
});

describe("matching a name", () => {
  it("agrees when every word of the shorter name is in the longer one, ignoring case, accents and company suffixes", () => {
    expect(sameName("Greenway Power Co", "greenway power")).toBe(true);
    expect(sameName("Café Müller GmbH", "cafe muller")).toBe(true);
    expect(sameName("Greenway Power", "Greenway Gas")).toBe(false);
  });

  it("does not match on one short word, or on nothing", () => {
    expect(sameName("Gas", "Gas Works Ltd")).toBe(false);
    expect(sameName("Inc", "Co")).toBe(false);
    expect(sameName("", "Greenway")).toBe(false);
  });
});

describe("checking a demand for money against the record", () => {
  it("matches a bill the family really received, from a payee it knows, for that exact amount", () => {
    const result = checkClaim(facts({ bills: [{ payeeId: greenway.id, cents: 8_640, state: "needs_review" }] }));
    expect(result).toMatchObject({ verdict: "match", reason: "open_bill", payeeId: greenway.id });
  });

  it("finds nothing for a payee the family does not know, whatever the amount", () => {
    expect(checkClaim(facts({ claimedPayee: "Revenue Recovery Dept" }))).toEqual({ verdict: "no_match", reason: "unknown_payee", payeeId: null, lastPayment: null });
  });

  it("refuses to match a demand for money the record shows as already paid, and names the payment", () => {
    const payment = { entryId: "e1", payeeId: greenway.id, cents: 8_640, day: "2026-10-12" };
    const result = checkClaim(facts({ payments: [payment], bills: [{ payeeId: greenway.id, cents: 8_640, state: "paid" }] }));
    expect(result).toMatchObject({ verdict: "no_match", reason: "already_paid", lastPayment: payment });
  });

  it("does not let a finished, rejected or duplicate bill make a demand match", () => {
    for (const state of ["paid", "rejected", "duplicate"]) {
      expect(checkClaim(facts({ bills: [{ payeeId: greenway.id, cents: 8_640, state }] })).verdict).not.toBe("match");
    }
  });

  it("cannot confirm a known payee asking for an amount the record does not hold, or for no amount", () => {
    expect(checkClaim(facts({ claimedCents: 12_000, bills: [{ payeeId: greenway.id, cents: 8_640, state: "ready" }] }))).toMatchObject({ verdict: "unclear", reason: "amount_differs" });
    expect(checkClaim(facts({ claimedCents: null }))).toMatchObject({ verdict: "unclear", reason: "no_amount" });
  });

  it("only compares with the payee's own bills and payments", () => {
    const other = { payeeId: "p-amara", cents: 8_640, state: "ready" };
    expect(checkClaim(facts({ bills: [other] })).verdict).toBe("unclear");
    expect(checkClaim(facts({ payments: [{ entryId: "e2", payeeId: "p-amara", cents: 8_640, day: "2026-10-01" }] })).reason).toBe("amount_differs");
  });

  it("reports the latest payment to the payee as the fact checked against", () => {
    const older = { entryId: "e1", payeeId: greenway.id, cents: 7_000, day: "2026-09-12" };
    const newer = { entryId: "e2", payeeId: greenway.id, cents: 7_100, day: "2026-10-12" };
    expect(checkClaim(facts({ payments: [older, newer] })).lastPayment).toEqual(newer);
  });
});
