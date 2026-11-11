import { DEMO_LEDGER_ENTRIES, snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import { sumCents } from "@kin/domain";
import { beforeAll, describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";

import { memberFairness, periodSettlement } from "./fairness";
import { circleNames } from "./names";
import { monthTotals, recordEntries } from "./record";
import { studioData, studioTotals, type StudioData } from "./studio-data";

const db = testDatabases();
let circle: Awaited<ReturnType<typeof snapshotFor>>;
let data: StudioData;

beforeAll(async () => {
  const ids = await visitorWithCircle(db);
  circle = await snapshotFor(db, ids.userId, ids.circleId);
  const dictionary = await getDictionary("en");
  data = studioData(circle, dictionary, circleNames(circle, dictionary));
});

describe("the family money studio's ledger", () => {
  it("holds every entry of the Record once, with whole cents only", () => {
    expect(data.ledger).toHaveLength(DEMO_LEDGER_ENTRIES);
    expect(new Set(data.ledger.map((row) => row.id)).size).toBe(DEMO_LEDGER_ENTRIES);
    for (const row of data.ledger) {
      for (const cents of [row.amountCents, row.inCents, row.outCents, row.feeCents, row.caregiverPayCents]) expect(Number.isSafeInteger(cents)).toBe(true);
      expect(row.month).toBe(row.day.slice(0, 7));
    }
  });

  it("splits each amount into money in or money out exactly as the Record's pool flow does", () => {
    const flows = new Map(recordEntries(circle).map((view) => [view.entry.id, view]));
    for (const row of data.ledger) {
      const view = flows.get(row.id);
      expect(view).toBeDefined();
      expect(row.inCents).toBe(view?.poolFlow === "in" ? view.cents : 0);
      expect(row.outCents).toBe(view?.poolFlow === "out" ? view.cents : 0);
      expect(row.feeCents).toBe(view?.feeCents);
    }
  });

  it("agrees with the month's own totals for October", () => {
    const october = data.ledger.filter((row) => row.month === "2026-10");
    const totals = monthTotals(circle, "2026-10");
    expect(sumCents(october.map((row) => row.inCents))).toBe(totals.paidInCents);
    expect(sumCents(october.map((row) => row.feeCents))).toBe(totals.feesCents);
  });

  it("labels the demo's entries as simulated and never counts one as confirmed by PayPal", () => {
    expect(data.ledger.every((row) => row.simulated && row.proof === "Simulated" && !row.paypalVerified && row.paypalId === "")).toBe(true);
    const totals = studioTotals(data.ledger);
    expect(totals).toMatchObject({ sandboxEntries: 0, simulatedEntries: DEMO_LEDGER_ENTRIES, verified: [] });
  });

  it("counts only payouts to a caregiver as caregiver pay, named after the caregiver", () => {
    for (const row of data.ledger) {
      if (row.caregiverPayCents > 0) {
        expect(row.caregiverPayCents).toBe(row.outCents);
        expect(row.caregiver).not.toBe("");
      } else {
        expect(row.caregiver).toBe("");
      }
    }
  });
});

describe("the family money studio's fairness", () => {
  it("is the money core's settlement of the open month, member by member", () => {
    const settlement = periodSettlement(circle, "2026-10");
    expect(settlement).not.toBeNull();
    if (settlement === null) return;
    expect(data.fairness.every((row) => row.month === "2026-10")).toBe(true);
    const october = data.fairness;
    const members = memberFairness(settlement, circle);
    expect(october.map((row) => [row.shareBps, row.givenCents, row.agreedCents, row.positionCents])).toEqual(
      members.map((member) => [member.shareBps, member.position.contributedCents, member.position.targetCents, member.position.positionCents]),
    );
  });
});
