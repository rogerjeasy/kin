import { rosesMonth, type Money } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { getDictionary } from "../i18n/dictionary";
import { locales } from "../i18n/locales";
import { exampleFamily } from "./example-family";

// "84" for 8400 cents. The page shows the formatted amount beside the spoken
// one, so the two must never drift apart.
function wholeUnits(money: Money): string {
  return String(money.cents).slice(0, -2);
}

describe("the example family", () => {
  it("has shares that add up to the whole cost", () => {
    const total = exampleFamily.shares.reduce((sum, share) => sum + share.percent, 0);
    expect(total).toBe(100);
  });

  it("has the shares of Rose's agreement in the money core", () => {
    expect(
      exampleFamily.shares.map(({ member, percent }) => ({
        memberId: member,
        bps: percent * 100,
      })),
    ).toEqual(rosesMonth.agreement.shares);
  });

  it("shows only amounts that Rose's ledger records", () => {
    const recorded = new Set(
      rosesMonth.ledger.entries.flatMap((entry) =>
        entry.lines.map((line) => line.cents),
      ),
    );
    const { electricityBill, gasBill, caregiverPay, refill } = exampleFamily;

    for (const amount of [electricityBill, gasBill, caregiverPay, refill]) {
      expect(recorded).toContain(amount.cents);
    }
  });
});

describe.each(locales)("the spoken amounts in the %s copy", (locale) => {
  it("match the example family's figures", async () => {
    const { home, caregiversPage } = await getDictionary(locale);
    const { electricityBill, caregiverPay, refill, settlement } = exampleFamily;

    expect(home.hero.spokenAmount).toContain(wholeUnits(electricityBill));
    expect(home.month.moments.bill.quote).toContain(wholeUnits(electricityBill));
    expect(home.voice.ask.kinAmount).toContain(wholeUnits(caregiverPay));
    expect(caregiversPage.exchange.kinAmount).toContain(wholeUnits(caregiverPay));
    expect(home.voice.decide.kinAmount).toContain(wholeUnits(refill));
    expect(home.month.moments.refill.quote).toContain(wholeUnits(refill));
    expect(home.month.moments.settled.quote).toContain(wholeUnits(settlement.elena));
    expect(home.month.moments.settled.quote).toContain(wholeUnits(settlement.ana));
  });
});
