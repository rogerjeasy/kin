import { snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import type { CircleSnapshot } from "@kin/db";
import { beforeAll, describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";

import { circleNames } from "./names";
import { recordCsv } from "./record-csv";

const db = testDatabases();
let circle: CircleSnapshot;

beforeAll(async () => {
  const visitor = await visitorWithCircle(db);
  circle = await snapshotFor(db, visitor.userId, visitor.circleId);
});

const rows = (csv: string) => csv.trimEnd().split("\r\n");

describe("the record as CSV", () => {
  it("has one row per ledger line, oldest first, each marked simulated", async () => {
    const english = await getDictionary("en");
    const lines = rows(recordCsv(circle, english, circleNames(circle, english)));
    const lineCount = circle.ledger.entries.reduce((sum, entry) => sum + entry.lines.length, 0);
    expect(lines).toHaveLength(lineCount + 1);
    expect(lines[0]).toBe("Date,Entry,Kind,Account,Debit,Credit,Simulated");
    expect(lines[1]?.startsWith("2026-10-01,")).toBe(true);
    expect(lines.slice(1).every((line) => line.endsWith(",yes"))).toBe(true);
  });

  it("balances: the debits and the credits of the whole record are equal, to the cent", async () => {
    const english = await getDictionary("en");
    const cents = (text: string) => (text === "" ? 0 : Number(text.replace(".", "")));
    let debits = 0;
    let credits = 0;
    for (const line of rows(recordCsv(circle, english, circleNames(circle, english))).slice(1)) {
      const cells = line.split(",");
      debits += cents(cells.at(-3) ?? "");
      credits += cents(cells.at(-2) ?? "");
    }
    expect(debits).toBe(credits);
    expect(debits).toBeGreaterThan(0);
  });

  it("writes text a spreadsheet would run as a formula as plain text, and quotes commas", async () => {
    const english = await getDictionary("en");
    const names = { ...circleNames(circle, english), subject: () => '=HYPERLINK("http://evil.example","pay, now")', member: () => "+SUM(A1)" };
    const csv = recordCsv(circle, english, names);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""pay, now"")`);
  });

  it("writes the columns and the yes in the reader's language", async () => {
    const french = await getDictionary("fr");
    const [header, first] = rows(recordCsv(circle, french, circleNames(circle, french)));
    expect(header).toBe("Date,Écriture,Type,Compte,Débit,Crédit,Simulé");
    expect(first?.endsWith(",oui")).toBe(true);
  });
});
