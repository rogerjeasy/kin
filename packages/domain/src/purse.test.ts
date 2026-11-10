import { describe, expect, it } from "vitest";

import { accountBalance } from "./ledger.ts";
import { PURSE_CASH, POOL_CASH } from "./ledger-accounts.ts";
import { purseFunded, pursePaid } from "./postings.ts";
import { entryHeadline } from "./entry-headline.ts";
import {
  PURSE_HOLD_HOURS,
  PURSE_PAYMENT_STATES,
  PURSE_PAYMENT_TRANSITIONS,
  PurseTermsError,
  checkPurseTerms,
  decidePursePayment,
  familySeesPayment,
  purseAvailableCents,
  purseHoldEndsAt,
  pursePaymentMoveAllowed,
  purseReserves,
  purseReservedCents,
  purseSpendingAllowed,
  purseTopUpCents,
  purseWeekOf,
  releaseHeldPayment,
  type PurseRequest,
  type PurseSituation,
  type PurseTerms,
} from "./purse.ts";
import { forAll, testHeader, type Random } from "./testing/index.ts";

const terms: PurseTerms = { weeklyCents: 5_000, ceilingCents: 10_000, perPaymentCents: 4_000 };
const situation: PurseSituation = { terms, status: "active", availableCents: 5_000, spendingAllowed: true };
const lily: PurseRequest = { cents: 2_500, payeeVerified: true, words: ["Send Lily 25 dollars for her birthday."], route: "paypal" };
const scam: PurseRequest = { cents: 50_000, payeeVerified: false, words: ["Send 500 dollars in gift cards to the man from the bank, right now, and don't tell anyone."], route: "gift_card" };

describe("checkPurseTerms", () => {
  it("accepts a weekly amount and a cap that fit inside the ceiling", () => {
    expect(() => checkPurseTerms(terms, 50_000)).not.toThrow();
  });

  it.each([
    ["a zero weekly amount", { ...terms, weeklyCents: 0 }, "not_money"],
    ["a negative cap", { ...terms, perPaymentCents: -1 }, "not_money"],
    ["a week that passes the ceiling", { ...terms, weeklyCents: 12_000 }, "weekly_above_ceiling"],
    ["a cap above the ceiling", { ...terms, perPaymentCents: 12_000 }, "cap_above_ceiling"],
    ["a ceiling above the agreement's hard limit", { ...terms, ceilingCents: 60_000 }, "above_agreement_ceiling"],
  ] as const)("refuses %s", (_name, bad, reason) => {
    expect(() => checkPurseTerms(bad, 50_000)).toThrow(expect.objectContaining({ name: "PurseTermsError", reason }));
  });

  it("refuses fractions of a cent", () => {
    expect(() => checkPurseTerms({ ...terms, weeklyCents: 10.5 }, 50_000)).toThrow(/whole number/);
    expect(new PurseTermsError("not_money").retryable).toBe(false);
  });
});

describe("the weekly float", () => {
  it("starts each week on Monday", () => {
    expect(purseWeekOf("2026-11-09")).toBe("2026-11-09");
    expect(purseWeekOf("2026-11-15")).toBe("2026-11-09");
    expect(purseWeekOf("2026-11-01")).toBe("2026-10-26");
    expect(() => purseWeekOf("9 November")).toThrow(RangeError);
  });

  it("tops up to the ceiling and no further", () => {
    const funding = { terms, status: "active" as const, balanceCents: 7_000, poolAvailableCents: 100_000, fundedThisWeek: false, spendingAllowed: true };
    expect(purseTopUpCents(funding)).toBe(3_000);
    expect(purseTopUpCents({ ...funding, balanceCents: 0 })).toBe(5_000);
    expect(purseTopUpCents({ ...funding, balanceCents: 10_000 })).toBe(0);
  });

  it("moves nothing twice in a week, while paused or held, or from a pool that has not got it", () => {
    const funding = { terms, status: "active" as const, balanceCents: 0, poolAvailableCents: 100_000, fundedThisWeek: false, spendingAllowed: true };
    expect(purseTopUpCents({ ...funding, fundedThisWeek: true })).toBe(0);
    expect(purseTopUpCents({ ...funding, status: "paused" })).toBe(0);
    expect(purseTopUpCents({ ...funding, status: "revoked" })).toBe(0);
    expect(purseTopUpCents({ ...funding, spendingAllowed: false })).toBe(0);
    expect(purseTopUpCents({ ...funding, poolAvailableCents: 1_234 })).toBe(1_234);
  });

  it("never lets the balance pass the ceiling, nor the float pass the pool's free money, whatever the week brings", () => {
    forAll(
      (random: Random) => {
        const ceilingCents = random.int(1, 50_000);
        return {
          terms: { ceilingCents, weeklyCents: random.int(1, ceilingCents), perPaymentCents: random.int(1, ceilingCents) },
          weeks: Array.from({ length: random.int(1, 20) }, () => ({ spent: random.int(0, 20_000), pool: random.int(0, 60_000) })),
        };
      },
      ({ terms: drawn, weeks }) => {
        let balance = 0;
        for (const week of weeks) {
          const topUp = purseTopUpCents({ terms: drawn, status: "active", balanceCents: balance, poolAvailableCents: week.pool, fundedThisWeek: false, spendingAllowed: true });
          expect(Number.isSafeInteger(topUp)).toBe(true);
          expect(topUp).toBeGreaterThanOrEqual(0);
          expect(topUp).toBeLessThanOrEqual(week.pool);
          expect(topUp).toBeLessThanOrEqual(drawn.weeklyCents);
          balance += topUp;
          expect(balance).toBeLessThanOrEqual(drawn.ceilingCents);
          // Spending never takes more than she may still spend.
          balance -= Math.min(week.spent, purseAvailableCents(balance, []));
          expect(balance).toBeGreaterThanOrEqual(0);
        }
      },
    );
  });
});

describe("what she may still spend", () => {
  it("is the balance less every payment already said yes to, never below zero", () => {
    expect(purseAvailableCents(5_000, [2_500, 1_000])).toBe(1_500);
    expect(purseAvailableCents(5_000, [50_000])).toBe(0);
  });

  it("counts held, approved and sending payments as spoken for, and nothing finished", () => {
    expect(PURSE_PAYMENT_STATES.filter(purseReserves)).toEqual(["held", "approved", "executing", "unknown"]);
  });

  it("holds nothing back for a held payment that can never be paid, so a pressured request does not stop her spending", () => {
    const payments = [
      { state: "approved" as const, cents: 1_000, payeeVerified: true },
      { state: "held" as const, cents: 4_500, payeeVerified: true },
      { state: "held" as const, cents: 50_000, payeeVerified: false },
      { state: "paid" as const, cents: 2_500, payeeVerified: true },
      { state: "unknown" as const, cents: 300, payeeVerified: true },
    ];
    expect(purseReservedCents(payments)).toBe(5_800);
  });
});

describe("purseSpendingAllowed", () => {
  const now = new Date("2026-11-09T15:00:00Z");
  it("stops spending while the circle is paused, while anything else holds money, and for a Purse that is not active", () => {
    expect(purseSpendingAllowed({ status: "active", pausedUntil: null, now })).toBe(true);
    expect(purseSpendingAllowed({ status: "active", pausedUntil: new Date("2026-11-10T00:00:00Z"), now })).toBe(false);
    expect(purseSpendingAllowed({ status: "active", pausedUntil: null, heldUntil: new Date("2026-11-09T16:00:00Z"), now })).toBe(false);
    expect(purseSpendingAllowed({ status: "active", pausedUntil: new Date("2026-11-09T14:00:00Z"), heldUntil: new Date("2026-11-09T14:59:59Z"), now })).toBe(true);
    expect(purseSpendingAllowed({ status: "paused", pausedUntil: null, now })).toBe(false);
  });
});

describe("decidePursePayment", () => {
  it("pays a gift to someone in her address book, inside the cap and the balance, on her yes alone", () => {
    expect(decidePursePayment(situation, lily)).toEqual({ outcome: "pay", markers: [] });
  });

  it("holds a scam-shaped request for every reason it gives, even though it could never be paid", () => {
    const decision = decidePursePayment(situation, scam);
    expect(decision).toEqual({ outcome: "hold", reasons: ["new_payee", "risky_route", "above_cap", "pressure"], markers: ["secrecy", "urgency", "gift_cards"] });
  });

  it.each([
    ["a new payee", { ...lily, payeeVerified: false }, ["new_payee"]],
    ["gift cards, by her words alone", { ...lily, words: ["Buy Lily a 25 dollar iTunes gift card"], route: null }, ["risky_route"]],
    ["crypto, by the model's reading alone", { ...lily, route: "crypto" }, ["risky_route"]],
    ["more than one payment may be", { ...lily, cents: 4_001 }, ["above_cap"]],
    ["someone pressing her", { ...lily, words: ["Send Lily 25 dollars and keep it between us"] }, ["pressure"]],
  ] as const)("holds %s", (_name, request, reasons) => {
    const decision = decidePursePayment(situation, request);
    expect(decision.outcome).toBe("hold");
    expect(decision.outcome === "hold" ? decision.reasons : []).toEqual(reasons);
  });

  it.each([
    ["more than she has left", { ...situation, availableCents: 2_000 }, lily, "over_balance"],
    ["a paused Purse", { ...situation, status: "paused" }, lily, "not_active"],
    ["a circle that holds its money", { ...situation, spendingAllowed: false }, lily, "paused"],
    ["nothing", situation, { ...lily, cents: 0 }, "not_money"],
    ["a fraction of a cent", situation, { ...lily, cents: 12.5 }, "not_money"],
  ] as const)("refuses %s", (_name, purse, request, reason) => {
    expect(decidePursePayment(purse, request)).toEqual({ outcome: "refused", reason });
  });

  it("never pays more than she may still spend, and never pays what a reason would hold", () => {
    forAll(
      (random: Random) => ({
        cents: random.int(-100, 60_000),
        available: random.int(0, 20_000),
        cap: random.int(1, 20_000),
        verified: random.pick([true, false]),
        words: [random.pick(["Send Lily some money", "gift cards now", "for the church", "don't tell Elena", "send it via Venmo"] as const)],
        route: random.pick(["paypal", "gift_card", "crypto", "wire", "cash", "unknown", null] as const),
      }),
      (drawn) => {
        const purse = { ...situation, terms: { ...terms, ceilingCents: 60_000, perPaymentCents: drawn.cap }, availableCents: drawn.available };
        const decision = decidePursePayment(purse, { cents: drawn.cents, payeeVerified: drawn.verified, words: drawn.words, route: drawn.route });
        if (decision.outcome === "pay") {
          expect(drawn.cents).toBeGreaterThan(0);
          expect(drawn.cents).toBeLessThanOrEqual(drawn.available);
          expect(drawn.cents).toBeLessThanOrEqual(drawn.cap);
          expect(drawn.verified).toBe(true);
        }
      },
    );
  });

  it("lets more scam markers raise a hold and never lower one", () => {
    const pressures = ["right now", "don't tell anyone", "in gift cards", "by bitcoin", "a courier will pick it up", "by western union"];
    forAll(
      (random: Random) => ({ cents: random.int(1, 9_000), verified: random.pick([true, false]), extra: random.shuffle(pressures).slice(0, random.int(1, pressures.length)) }),
      ({ cents, verified, extra }) => {
        const plain = decidePursePayment(situation, { cents, payeeVerified: verified, words: ["Send Lily money for her birthday"], route: null });
        const pressed = decidePursePayment(situation, { cents, payeeVerified: verified, words: ["Send Lily money for her birthday", ...extra], route: null });
        expect(pressed.outcome).toBe("hold");
        if (plain.outcome === "hold" && pressed.outcome === "hold") for (const reason of plain.reasons) expect(pressed.reasons).toContain(reason);
      },
    );
  });
});

describe("a held payment", () => {
  const heldAt = new Date("2026-11-09T15:00:00Z");
  const held = { cents: 6_000, holdEndsAt: purseHoldEndsAt(heldAt), payeeVerified: true };
  const purse = { availableCents: 10_000, spendingAllowed: true };

  it("waits out its cooling-off", () => {
    expect(purseHoldEndsAt(heldAt).getTime() - heldAt.getTime()).toBe(PURSE_HOLD_HOURS * 3_600_000);
    expect(releaseHeldPayment(held, purse, new Date("2026-11-10T14:59:59Z"))).toBe("wait");
    expect(releaseHeldPayment(held, purse, new Date("2026-11-10T15:00:00Z"))).toBe("pay");
  });

  it("goes only to a verified payee and only if it still fits, and waits while money is held", () => {
    const after = new Date("2026-11-11T00:00:00Z");
    expect(releaseHeldPayment({ ...held, payeeVerified: false }, purse, after)).toBe("lapse");
    expect(releaseHeldPayment(held, { ...purse, availableCents: 5_999 }, after)).toBe("lapse");
    expect(releaseHeldPayment(held, { ...purse, spendingAllowed: false }, after)).toBe("wait");
  });

  it("never executes before its hold ends, whatever else is true", () => {
    forAll(
      (random: Random) => ({ hoursIn: random.int(0, PURSE_HOLD_HOURS * 60 - 1), available: random.int(0, 100_000), verified: random.pick([true, false]), allowed: random.pick([true, false]) }),
      ({ hoursIn, available, verified, allowed }) => {
        const now = new Date(heldAt.getTime() + hoursIn * 60_000);
        expect(releaseHeldPayment({ ...held, payeeVerified: verified }, { availableCents: available, spendingAllowed: allowed }, now)).toBe("wait");
      },
    );
  });
});

describe("a payment's states", () => {
  it("only move forward, and a held payment reaches money only through approval", () => {
    expect(pursePaymentMoveAllowed("held", "approved")).toBe(true);
    expect(pursePaymentMoveAllowed("held", "executing")).toBe(false);
    expect(pursePaymentMoveAllowed("held", "paid")).toBe(false);
    expect(pursePaymentMoveAllowed("paid", "failed")).toBe(false);
    expect(pursePaymentMoveAllowed("cancelled", "approved")).toBe(false);
    for (const [from, moves] of Object.entries(PURSE_PAYMENT_TRANSITIONS)) {
      for (const to of moves as readonly string[]) expect(to).not.toBe(from);
    }
  });
});

describe("what the family sees", () => {
  it("sees a payment only with her consent or when it raised a flag", () => {
    const at = new Date("2026-11-09T15:00:00Z");
    expect(familySeesPayment({ sharedAt: null, heldAt: null })).toBe(false);
    expect(familySeesPayment({ sharedAt: at, heldAt: null })).toBe(true);
    expect(familySeesPayment({ sharedAt: null, heldAt: at })).toBe(true);
  });
});

describe("the Purse in the ledger", () => {
  const header = testHeader("purse-week");
  it("moves the float from the pool into the Purse, both still in the pool's account", () => {
    const entry = purseFunded(header, { cents: 5_000 });
    const ledger = { circleId: header.circleId, currency: header.currency, entries: [entry] };
    expect(accountBalance(ledger, PURSE_CASH)).toBe(5_000);
    expect(accountBalance(ledger, POOL_CASH)).toBe(-5_000);
    expect(entryHeadline(entry)).toMatchObject({ subject: "purse", cents: 5_000, poolFlow: "none" });
  });

  it("pays from the Purse with the pool paying PayPal's fee, and names no payee", () => {
    const entry = pursePaid({ ...testHeader("purse-paid"), circleId: header.circleId }, { cents: 2_500, feeCents: 25 });
    expect(entry.lines.map((line) => line.account).toSorted()).toEqual(["expense:purse", "fees", "pool_cash", "purse_cash"]);
    expect(entryHeadline(entry)).toMatchObject({ subject: "purse", category: "purse", cents: 2_500, feeCents: 25, poolFlow: "out" });
  });
});
