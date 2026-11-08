import type { CsvExportParams, ShouldRowBeSkippedParams, ProcessCellForExportParams } from "ag-grid-community";
import { decimalAmount, poolMovementCents, type MovementTotals } from "@kin/domain";

import { csvCell, csvRow, defuseFormula } from "@/lib/csv-cell";
import { fill } from "@/i18n/template";

import { LEDGER_COLUMN } from "./ledger-columns-ids.ts";
import { isEntry, type LedgerGridRow, type LedgerRow } from "./ledger-row.ts";

/** What the file holds, in order, whichever columns the person has on screen. */
export const EXPORT_COLUMNS = [
  LEDGER_COLUMN.date,
  LEDGER_COLUMN.entry,
  LEDGER_COLUMN.kind,
  LEDGER_COLUMN.person,
  LEDGER_COLUMN.category,
  LEDGER_COLUMN.source,
  LEDGER_COLUMN.reference,
  LEDGER_COLUMN.id,
  LEDGER_COLUMN.reverses,
  LEDGER_COLUMN.amount,
  LEDGER_COLUMN.effect,
] as const;

export type LedgerExportCopy = {
  title: string;
  generated: string;
  rowsShown: string;
  total: string;
};

export type LedgerExportInput = {
  currency: string;
  circleName: string;
  /** The day the file was made, `YYYY-MM-DD`, on the circle's clock. */
  generatedOn: string;
  copy: LedgerExportCopy;
  /** What the view totals, and how many entries there are in all. */
  shown: MovementTotals;
  entryCount: number;
};

/** One cell of the file for an entry: text defused for a spreadsheet, money as exact decimals from cents. */
export function exportCell(row: LedgerRow, columnId: string, currency: string): string {
  switch (columnId) {
    case LEDGER_COLUMN.date:
      return row.isoDay;
    case LEDGER_COLUMN.entry:
      return defuseFormula(row.text);
    case LEDGER_COLUMN.kind:
      return defuseFormula(row.kind);
    case LEDGER_COLUMN.person:
      return defuseFormula(row.person.label);
    case LEDGER_COLUMN.category:
      return defuseFormula(row.category.label);
    case LEDGER_COLUMN.source:
      return defuseFormula(row.source);
    case LEDGER_COLUMN.reference:
      return defuseFormula(row.sourceId);
    case LEDGER_COLUMN.id:
      return defuseFormula(row.id);
    case LEDGER_COLUMN.reverses:
      return defuseFormula(row.reverses ?? "");
    case LEDGER_COLUMN.amount:
      return decimalAmount({ cents: row.cents, currency });
    case LEDGER_COLUMN.effect:
      return decimalAmount({ cents: poolMovementCents(row), currency });
    default:
      return "";
  }
}

/** The lines above the column headings: whose record it is, when it was made, and how much of it. */
export function exportPrelude({ circleName, generatedOn, copy, shown, entryCount }: LedgerExportInput): string {
  return [
    [fill(copy.title, { circle: circleName })],
    [fill(copy.generated, { date: generatedOn })],
    [fill(copy.rowsShown, { shown: String(shown.count), total: String(entryCount) })],
  ]
    .map(csvRow)
    // The grid's own export starts the column headings on a new line.
    .join("\r\n");
}

/**
 * The closing line: what the entries in the file did to the pool, under the
 * column that says so. The amount is written as it is: a negative net must
 * stay a number, not be defused as though it were a formula.
 */
export function exportTotalLine({ currency, copy, shown }: LedgerExportInput): string {
  const cells = EXPORT_COLUMNS.map((column) => {
    if (column === LEDGER_COLUMN.entry) return csvCell(copy.total);
    if (column === LEDGER_COLUMN.effect) return decimalAmount({ cents: shown.netCents, currency });
    return "";
  });
  return `\r\n${cells.join(",")}`;
}

/**
 * The options that make the grid's own CSV export write the view as it is:
 * the filtered and sorted entries (not the group headings), the same columns
 * whatever is on screen, and a heading above and a total below.
 */
export function ledgerCsvParams(input: LedgerExportInput): CsvExportParams {
  return {
    columnKeys: [...EXPORT_COLUMNS],
    prependContent: exportPrelude(input),
    appendContent: exportTotalLine(input),
    shouldRowBeSkipped: ({ node }: ShouldRowBeSkippedParams) => !isEntry(node.data as LedgerGridRow | undefined),
    processCellCallback: ({ node, column }: ProcessCellForExportParams) => {
      const row = node?.data as LedgerGridRow | undefined;
      return isEntry(row) ? exportCell(row, column.getColId(), input.currency) : "";
    },
  };
}
