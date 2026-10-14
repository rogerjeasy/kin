import { describe, expect, it } from "vitest";

import type { Agreement } from "./agreement.ts";
import { reverseEntry } from "./ledger-entry.ts";
import { appendEntries, openLedger } from "./ledger.ts";
import { PeriodInputError, periodInputs } from "./period-inputs.ts";
import {
  careCreditLogged,
  contributionReceived,
  outOfPocketApproved,
  purchaseCaptured,
  settlementCollected,
  settlementPaidOut,
} from "./postings.ts";
import {
  TEST_CIRCLE,
  TEST_CURRENCY,
  TEST_PERIOD,
  testHeader,
} from "./testing/entries.ts";

const agreement: Agreement = {
  version: 3,
  shares: [
    { memberId: "elena", bps: 6000 },
    { memberId: "ana", bps: 4000 },
  ],
  care: { rateCentsPerHour: 2000, paidInCash: false },
};

const sale = contributionReceived(testHeader("sale-elena"), {
  memberId: "elena",
  grossCents: 30000,
  feeCents: 1067,
});

const entries = [
  sale,
  contributionReceived(testHeader("sale-ana"), {
    memberId: "ana",
    grossCents: 20000,
    feeCents: 728,
  }),
  outOfPocketApproved(testHeader("receipt-elena"), {
    memberId: "elena",
    category: "pharmacy",
    cents: 7200,
  }),
  careCreditLogged(testHeader("care-ana"), {
    memberId: "ana",
    minutes: 90,
    rateCentsPerHour: 2000,
  }),
  purchaseCaptured(testHeader("refill"), { category: "pharmacy", cents: 4200 }),
];

const ledger = appendEntries(openLedger(TEST_CIRCLE, TEST_CURRENCY), entries);

describe("periodInputs", () => {
  it("reads each member's cash, own spending and care credit", () => {
    expect(periodInputs({ ledger, agreement, period: TEST_PERIOD })).toEqual({
      currency: "USD",
      careCreditPaidInCash: false,
      members: [
        {
          memberId: "elena",
          shareBps: 6000,
          paidInCents: 30000,
          outOfPocketCents: 7200,
          careCreditCents: 0,
          carriedInCents: 0,
        },
        {
          memberId: "ana",
          shareBps: 4000,
          paidInCents: 20000,
          outOfPocketCents: 0,
          careCreditCents: 3000,
          carriedInCents: 0,
        },
      ],
    });
  });

  it("credits a member with the gross amount, whatever the fee", () => {
    const [elena] = periodInputs({ ledger, agreement, period: TEST_PERIOD }).members;

    expect(elena?.paidInCents).toBe(30000);
  });

  it("counts only the entries of the period asked for", () => {
    const later = contributionReceived(
      testHeader("sale-elena-november", { period: "2026-11" }),
      { memberId: "elena", grossCents: 30000, feeCents: 0 },
    );
    const withLater = appendEntries(ledger, [later]);
    const november = periodInputs({ ledger: withLater, agreement, period: "2026-11" });

    expect(november.members.map((each) => each.paidInCents)).toEqual([30000, 0]);
  });

  it("nets a refunded contribution to nothing", () => {
    const refund = reverseEntry(sale, {
      id: "entry-refund",
      occurredOn: "2026-10-20",
      period: TEST_PERIOD,
      description: "Refund",
      source: { type: "paypal_event", id: "refund" },
    });
    const refunded = appendEntries(ledger, [refund]);
    const [elena] = periodInputs({ ledger: refunded, agreement, period: TEST_PERIOD }).members;

    expect(elena?.paidInCents).toBe(0);
  });

  it("leaves settlement movements out, because they close an earlier period", () => {
    const settled = appendEntries(ledger, [
      settlementCollected(testHeader("collect-ana"), {
        memberId: "ana",
        grossCents: 5000,
        feeCents: 0,
      }),
      settlementPaidOut(testHeader("payout-elena"), {
        memberId: "elena",
        cents: 5000,
        feeCents: 25,
      }),
    ]);

    expect(periodInputs({ ledger: settled, agreement, period: TEST_PERIOD })).toEqual(
      periodInputs({ ledger, agreement, period: TEST_PERIOD }),
    );
  });

  it("ignores care credit when the agreement does not count care", () => {
    const inputs = periodInputs({
      ledger,
      agreement: { ...agreement, care: null },
      period: TEST_PERIOD,
    });

    expect(inputs.members.map((each) => each.careCreditCents)).toEqual([0, 0]);
  });

  it("carries in what the last settlement left open", () => {
    const inputs = periodInputs({
      ledger,
      agreement,
      period: TEST_PERIOD,
      carriedIn: new Map([["ana", -1200]]),
    });

    expect(inputs.members.map((each) => each.carriedInCents)).toEqual([0, -1200]);
  });

  it("stops when a member without a share gave something", () => {
    const stranger = appendEntries(ledger, [
      contributionReceived(testHeader("sale-marcus"), {
        memberId: "marcus",
        grossCents: 10000,
        feeCents: 0,
      }),
    ]);

    expect(() =>
      periodInputs({ ledger: stranger, agreement, period: TEST_PERIOD }),
    ).toThrow(PeriodInputError);
    expect(() =>
      periodInputs({
        ledger,
        agreement,
        period: TEST_PERIOD,
        carriedIn: new Map([["marcus", 500]]),
      }),
    ).toThrow(PeriodInputError);
  });
});
