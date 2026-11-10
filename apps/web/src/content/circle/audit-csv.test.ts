import { snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import type { CircleSnapshot } from "@kin/db";
import { beforeAll, describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";

import { auditCsv } from "./audit-csv";
import { circleNames } from "./names";
import { expectedAfter, requestedPeriod, statementPeriods } from "./statement";

const db = testDatabases();
let circle: CircleSnapshot;

beforeAll(async () => {
  const visitor = await visitorWithCircle(db);
  circle = await snapshotFor(db, visitor.userId, visitor.circleId);
});

const rows = (csv: string) => csv.trimEnd().split("\r\n");

describe("the audit export", () => {
  it("has one row per ledger line, each naming its entry, its source and its reference", async () => {
    const english = await getDictionary("en");
    const lines = rows(auditCsv(circle, english, circleNames(circle, english)));
    const lineCount = circle.ledger.entries.reduce((sum, entry) => sum + entry.lines.length, 0);
    expect(lines).toHaveLength(lineCount + 1);
    expect(lines[0]).toBe("Date,Entry ID,Entry,Kind,Source,Source reference,Reverses,Account,Debit,Credit,Currency,Simulated");
    const first = circle.ledger.entries[0];
    expect(lines[1]).toContain(`,${first?.id},`);
    expect(lines[1]).toContain(`,${first?.source.id},`);
  });

  it("never calls a simulated entry's cause a PayPal event, and calls a real one so", async () => {
    const english = await getDictionary("en");
    const names = circleNames(circle, english);
    const simulated = auditCsv(circle, english, names);
    expect(simulated).not.toContain(",PayPal event,");
    expect(simulated).toContain(",Simulated,");
    expect(simulated).not.toContain("PayPal event");
    const real = { ...circle, ledger: { ...circle.ledger, entries: circle.ledger.entries.map((entry) => ({ ...entry, simulated: false })) } };
    expect(auditCsv(real, english, names)).toContain(",PayPal event,");
    expect(auditCsv(real, english, names)).not.toContain(",Simulated,");
  });

  it("writes the columns in the reader's language", async () => {
    const french = await getDictionary("fr");
    const [header] = rows(auditCsv(circle, french, circleNames(circle, french)));
    expect(header?.startsWith("Date,ID de l’écriture,")).toBe(true);
  });
});

describe("which month a statement is for", () => {
  it("lists the months with entries, newest first, and falls back to the open month", () => {
    const months = statementPeriods(circle);
    expect(months).toEqual(months.toSorted().toReversed());
    expect(months).toContain("2026-10");
    expect(requestedPeriod(circle, "2026-10")).toBe("2026-10");
    expect(requestedPeriod(circle, "1999-01")).toBe(requestedPeriod(circle, undefined));
    expect(requestedPeriod(circle, "not-a-month")).toBe(requestedPeriod(circle, undefined));
  });

  it("expects the bills due in the month after", () => {
    expect(expectedAfter(circle, "2026-10").every((bill) => bill.due.startsWith("2026-11"))).toBe(true);
    expect(expectedAfter(circle, "2026-10").length).toBeGreaterThan(0);
  });
});
