import { describe, expect, it } from "vitest";

import type { CareAgreementFacts } from "./care-agreement.ts";
import type { LedgerEntry } from "./ledger-entry.ts";
import { classifyOutflows, lookbackStart, OUTFLOW_CLASSES, type LookbackContext } from "./lookback.ts";
import { judgeRate } from "./rate-benchmark.ts";
import { payoutConfirmed, purchaseCaptured, settlementPaidOut, contributionReceived } from "./postings.ts";
import { reverseEntry } from "./ledger-entry.ts";
import { forAll, randomEntry, testHeader } from "./testing/index.ts";

const agreement: CareAgreementFacts = {
  id: "agreement-1",
  payeeId: "maya",
  state: "draft",
  rateCentsPerHour: 3000,
  startsOn: "2026-10-01",
  endTerm: "either_party_30_days",
  endsOn: null,
  endedOn: null,
  signatures: [
    { memberId: "maya-member", capacity: "caregiver", signedOn: "2026-10-01" },
    { memberId: "rose", capacity: "care_recipient", signedOn: "2026-10-01" },
  ],
};

const context = (over: Partial<LookbackContext> = {}): LookbackContext => ({
  today: "2026-11-09",
  currency: "USD",
  caregiverPayeeIds: new Set(["maya"]),
  agreements: [agreement],
  work: new Map(),
  documented: new Set(),
  ...over,
});

const paid = (name: string, on: string, payeeId: string, cents = 30_000): LedgerEntry => payoutConfirmed(testHeader(name, { occurredOn: on, period: on.slice(0, 7), simulated: false }), { payeeId, cents, feeCents: 25 });

describe("the 60-month window", () => {
  it("starts on the same day five years back, and 29 February becomes the 28th", () => {
    expect(lookbackStart("2026-11-09")).toBe("2021-11-09");
    expect(lookbackStart("2024-02-29")).toBe("2019-02-28");
  });

  it("leaves out what was paid before the window or after today", () => {
    const rows = classifyOutflows([paid("old", "2021-11-08", "maya"), paid("edge", "2021-11-09", "maya"), paid("future", "2026-11-10", "maya")], context()).rows;
    expect(rows.map((row) => row.entryId)).toEqual(["entry-edge"]);
  });
});

describe("classifying payments out", () => {
  it("documents caregiver pay for work an agreement covers, and says which", () => {
    const entry = paid("p1", "2026-10-20", "maya");
    const { rows } = classifyOutflows([entry], context({ work: new Map([[entry.id, { dates: ["2026-10-19"], verified: true, rateCentsPerHour: 3000 }]]) }));
    expect(rows[0]).toMatchObject({ class: "caregiver_pay", status: "documented", agreementId: "agreement-1", reasons: [], marks: ["paypal"] });
  });

  it("lists pay at a rate the covering agreement does not state, and keeps the agreement off the row", () => {
    const entry = paid("p-rate", "2026-10-20", "maya");
    const { rows } = classifyOutflows([entry], context({ work: new Map([[entry.id, { dates: ["2026-10-19"], verified: true, rateCentsPerHour: 2200 }]]) }));
    expect(rows[0]).toMatchObject({ class: "caregiver_pay", status: "needs_documentation", agreementId: null, reasons: ["rate_not_agreed"] });
  });

  it("lists pay for work done before the agreement was signed, but marks an unverified visit without condemning it", () => {
    const entry = paid("p2", "2026-10-20", "maya");
    const before = classifyOutflows([entry], context({ work: new Map([[entry.id, { dates: ["2026-09-20"], verified: false, rateCentsPerHour: 3000 }]]) })).rows[0];
    expect(before).toMatchObject({ status: "needs_documentation", reasons: ["before_agreement"], marks: ["paypal", "unverified_hours"] });
  });

  it("lists pay to a caregiver with no agreement on file", () => {
    const row = classifyOutflows([paid("p3", "2026-10-20", "maya")], context({ agreements: [] })).rows[0];
    expect(row).toMatchObject({ status: "needs_documentation", reasons: ["no_agreement"] });
  });

  it("marks a rate far from the market", () => {
    const entry = paid("p4", "2026-10-20", "maya");
    const row = classifyOutflows([entry], context({ work: new Map([[entry.id, { dates: ["2026-10-19"], verified: true, rateCentsPerHour: 1000 }]]) })).rows[0];
    expect(row?.marks).toEqual(["paypal", "rate_below_market"]);
    expect(judgeRate(5000, "USD").judgement).toBe("near");
    expect(judgeRate(5300, "USD").judgement).toBe("above");
    expect(judgeRate(2100, "USD").judgement).toBe("near");
    expect(judgeRate(2099, "USD").judgement).toBe("below");
    expect(judgeRate(3000, "EUR").judgement).toBe("unknown");
  });

  it("sorts the other outflows and asks for the paper behind each", () => {
    const bill = paid("bill", "2026-10-02", "water");
    const buy = purchaseCaptured(testHeader("buy", { occurredOn: "2026-10-03" }), { category: "pharmacy", cents: 2_000 });
    const family = settlementPaidOut(testHeader("family", { occurredOn: "2026-10-04" }), { memberId: "ana", cents: 5_000, feeCents: 25 });
    const { rows } = classifyOutflows([bill, buy, family], context({ documented: new Set([bill.id]) }));
    expect(rows.map((row) => [row.class, row.status, row.reasons])).toEqual([
      ["third_party_bill", "documented", []],
      ["purchase_for_parent", "needs_documentation", ["no_document"]],
      ["family_transfer", "needs_documentation", ["family_transfer"]],
    ]);
  });

  it("keeps a reversed payment in the list, shows it as reversed and leaves it out of the totals", () => {
    const entry = paid("r1", "2026-10-20", "water");
    const reversal = reverseEntry(entry, testHeader("r1-undo", { occurredOn: "2026-10-21" }));
    const summary = classifyOutflows([entry, reversal], context());
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]?.status).toBe("reversed");
    expect(summary.outflowCents).toBe(0);
  });

  it("ignores money coming in", () => {
    const entry = contributionReceived(testHeader("in"), { memberId: "ana", grossCents: 10_000, feeCents: 0 });
    expect(classifyOutflows([entry], context()).rows).toEqual([]);
  });
});

describe("the properties of the classification", () => {
  it("gives every payment that left the pool exactly one row, and the totals add up", () => {
    forAll(
      (random) => Array.from({ length: random.int(0, 12) }, (_, index) => randomEntry(random, `e${index}`)),
      (entries) => {
        const summary = classifyOutflows(entries, context({ today: "2026-10-31" }));
        const out = entries.filter((entry) => entry.lines.some((line) => line.account === "pool_cash" && line.direction === "credit"));
        expect(new Set(summary.rows.map((row) => row.entryId)).size).toBe(summary.rows.length);
        expect(summary.rows.length).toBe(out.filter((entry) => entry.kind !== "settlement_collection").length);
        expect(summary.documentedCents + summary.lackingCents).toBe(summary.outflowCents);
        expect(OUTFLOW_CLASSES.reduce((sum, each) => sum + summary.byClass[each].cents, 0)).toBe(summary.outflowCents);
        // Every row says whether it stands for no money or went through PayPal, never both and never neither.
        for (const row of summary.rows) expect(row.marks.filter((mark) => mark === "simulated" || mark === "paypal")).toEqual([row.simulated ? "simulated" : "paypal"]);
      },
    );
  });
});
