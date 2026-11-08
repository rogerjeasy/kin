import { describe, expect, it } from "vitest";

import { EXPORT_COLUMNS, exportCell, exportPrelude, exportTotalLine, ledgerCsvParams, type LedgerExportInput } from "./ledger-export.ts";
import { LEDGER_COLUMN } from "./ledger-columns-ids.ts";
import type { LedgerRow } from "./ledger-row.ts";

const row = (over: Partial<LedgerRow> = {}): LedgerRow =>
  ({
    rowKind: "entry",
    id: "ent_1",
    isoDay: "2026-10-01",
    period: "2026-10",
    text: "Marcus’s contribution",
    kind: "Contribution",
    source: "PayPal event",
    sourceId: "PAYPAL-EVT-1",
    reverses: null,
    simulated: true,
    cents: 40_913,
    flow: "in",
    person: { key: "m1", label: "Marcus" },
    category: { key: "none", label: "No category" },
    month: { key: "2026-10", label: "October 2026" },
    tags: ["Simulated"],
    ...over,
  }) as LedgerRow;

const input: LedgerExportInput = {
  currency: "USD",
  circleName: "Rose’s circle",
  generatedOn: "2026-11-08",
  copy: { title: "Kin record: {circle}", generated: "Generated on {date}", rowsShown: "Entries in this file: {shown} of {total}", total: "Total" },
  shown: { count: 2, inCents: 40_913, outCents: 12_600, netCents: 28_313 },
  entryCount: 19,
};

describe("exportCell", () => {
  it("writes money as exact decimals from cents, never through a float", () => {
    expect(exportCell(row({ cents: 40_913 }), LEDGER_COLUMN.amount, "USD")).toBe("409.13");
    expect(exportCell(row({ cents: 5 }), LEDGER_COLUMN.amount, "USD")).toBe("0.05");
    expect(exportCell(row({ cents: 9_007_199_254_740_991 }), LEDGER_COLUMN.amount, "USD")).toBe("90071992547409.91");
  });

  it("signs the effect on the pool: in positive, out negative, care time zero", () => {
    expect(exportCell(row({ flow: "in", cents: 12_600 }), LEDGER_COLUMN.effect, "USD")).toBe("126.00");
    expect(exportCell(row({ flow: "out", cents: 12_600 }), LEDGER_COLUMN.effect, "USD")).toBe("-126.00");
    expect(exportCell(row({ flow: "none", cents: 8_000 }), LEDGER_COLUMN.effect, "USD")).toBe("0.00");
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    expect(exportCell(row({ text: "=HYPERLINK(\"http://x\")" }), LEDGER_COLUMN.entry, "USD")).toBe("'=HYPERLINK(\"http://x\")");
    expect(exportCell(row({ person: { key: "x", label: "+Evil" } }), LEDGER_COLUMN.person, "USD")).toBe("'+Evil");
  });

  it("leaves right-to-left text and ordinary text as written", () => {
    expect(exportCell(row({ text: "مساهمة ماركوس" }), LEDGER_COLUMN.entry, "USD")).toBe("مساهمة ماركوس");
    expect(exportCell(row({ text: "Gas, water" }), LEDGER_COLUMN.entry, "USD")).toBe("Gas, water");
  });

  it("names the entry it cancels, or nothing", () => {
    expect(exportCell(row({ reverses: "ent_0" }), LEDGER_COLUMN.reverses, "USD")).toBe("ent_0");
    expect(exportCell(row(), LEDGER_COLUMN.reverses, "USD")).toBe("");
  });

  it("writes whole-unit currencies without a fraction", () => {
    expect(exportCell(row({ cents: 5_000 }), LEDGER_COLUMN.amount, "JPY")).toBe("5000");
  });
});

describe("the lines around the rows", () => {
  it("opens with whose record it is, the day it was made on the circle's clock and how much of it", () => {
    expect(exportPrelude(input).split("\r\n")).toEqual(["Kin record: Rose’s circle", "Generated on 2026-11-08", "Entries in this file: 2 of 19"]);
  });

  it("quotes a circle name with a comma or a quote, and defuses one that starts like a formula", () => {
    expect(exportPrelude({ ...input, circleName: 'The "Rivera, Sam" circle' }).split("\r\n")[0]).toBe('"Kin record: The ""Rivera, Sam"" circle"');
    expect(exportPrelude({ ...input, circleName: "=1+1" }).split("\r\n")[0]).toBe("Kin record: =1+1");
  });

  it("closes with the net under the effect column, from cents", () => {
    const cells = exportTotalLine(input).trim().split(",");
    expect(cells).toHaveLength(EXPORT_COLUMNS.length);
    expect(cells[EXPORT_COLUMNS.indexOf(LEDGER_COLUMN.entry)]).toBe("Total");
    expect(cells.at(-1)).toBe("283.13");
  });

  it("closes with a negative net as a negative decimal", () => {
    expect(exportTotalLine({ ...input, shown: { count: 1, inCents: 0, outCents: 300, netCents: -300 } }).trim().split(",").at(-1)).toBe("-3.00");
  });
});

describe("ledgerCsvParams", () => {
  const params = ledgerCsvParams(input);

  it("exports the same columns whichever are on screen", () => {
    expect(params.columnKeys).toEqual([...EXPORT_COLUMNS]);
  });

  it("skips group headings and the totals row, keeping only entries", () => {
    const skip = params.shouldRowBeSkipped;
    expect(skip?.({ node: { data: { rowKind: "group" } } } as never)).toBe(true);
    expect(skip?.({ node: { data: { rowKind: "total" } } } as never)).toBe(true);
    expect(skip?.({ node: { data: row() } } as never)).toBe(false);
  });

  it("writes an entry's cell by its column", () => {
    const cell = params.processCellCallback;
    expect(cell?.({ node: { data: row() }, column: { getColId: () => LEDGER_COLUMN.amount } } as never)).toBe("409.13");
  });
});
