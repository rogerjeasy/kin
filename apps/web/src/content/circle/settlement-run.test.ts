import { snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import type { CircleSnapshot, ReceiptRecord } from "@kin/db";
import { beforeAll, describe, expect, it } from "vitest";

import { getDictionary, type Dictionary } from "@/i18n/dictionary";
import { formatters } from "@/lib/format";

import { circleNames } from "./names";
import { receiptRows } from "./settlement-run";

const db = testDatabases();
const format = formatters("en", "USD");
let circle: CircleSnapshot;
let english: Dictionary;
let elena: string;

beforeAll(async () => {
  const visitor = await visitorWithCircle(db);
  circle = await snapshotFor(db, visitor.userId, visitor.circleId);
  english = await getDictionary("en");
  elena = visitor.members.elena;
});

const rowsOf = (snapshot: CircleSnapshot) => receiptRows(snapshot, circleNames(snapshot, english), format, english.dashboard.fairness.receipts);
const pocketEntries = () => circle.ledger.entries.filter((entry) => entry.kind === "out_of_pocket");

describe("the receipts list", () => {
  it("shows the receipts the record counts toward Elena's share, as the member card and the record do", () => {
    expect(circle.receipts).toEqual([]);
    expect(rowsOf(circle).map((row) => [row.title, row.amount, row.stateText, row.decidable])).toEqual([
      ["Pharmacy receipt", "$49.50", "Counted toward Elena’s share", false],
      ["Pharmacy receipt", "$58.50", "Counted toward Elena’s share", false],
      ["Pharmacy receipt", "$72.00", "Counted toward Elena’s share", false],
    ]);
  });

  it("lists a filed receipt once, not again for the entry it was credited by", () => {
    const [credited] = pocketEntries();
    if (!credited) throw new Error("The demo holds Elena's pharmacy receipts");
    const filed: ReceiptRecord = { id: "filed", memberId: elena, category: "pharmacy", cents: 7200, description: "Elm Street Pharmacy", spentOn: credited.occurredOn, state: "credited", decidedBy: null, entryId: credited.id, billId: null };
    const rows = rowsOf({ ...circle, receipts: [filed] });
    expect(rows).toHaveLength(3);
    expect(rows[0]?.title).toBe("Elm Street Pharmacy");
    expect(rows.some((row) => row.id === credited.id)).toBe(false);
  });

  it("leaves out a receipt the record has reversed, and the reversal", () => {
    const [wrong] = pocketEntries();
    if (!wrong) throw new Error("The demo holds Elena's pharmacy receipts");
    const reversal = { ...wrong, id: "reversal", reverses: wrong.id };
    const rows = rowsOf({ ...circle, ledger: { ...circle.ledger, entries: [...circle.ledger.entries, reversal] } });
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.id === wrong.id || row.id === "reversal")).toBe(false);
  });
});
