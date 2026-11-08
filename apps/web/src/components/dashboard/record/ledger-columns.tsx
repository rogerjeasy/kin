import type { ColDef, ValueGetterParams } from "ag-grid-community";
import { centsFromDecimal, decimalAmount, InvalidDecimalError } from "@kin/domain";

import type { GridCopy } from "@/components/data-grid/data-grid";
import type { Dictionary } from "@/i18n/dictionary";
import type { Formatters } from "@/lib/format";

import { AmountCell, DayCell, EntryCell } from "./entry-cells";
import { LEDGER_COLUMN } from "./ledger-columns-ids.ts";
import { isEntry, type LedgerGridRow, type LedgerRow, type LedgerVariant } from "./ledger-row.ts";
import { searchTextOf } from "./ledger-search.ts";

type LedgerColumnsInput = {
  variant: LedgerVariant;
  record: Dictionary["dashboard"]["record"];
  grid: GridCopy;
  currency: string;
  format: Formatters;
};

/** The columns each screen opens with. The rest are one click away in the chooser, and always in the download. */
const SHOWN: Record<LedgerVariant, readonly string[]> = {
  record: [LEDGER_COLUMN.date, LEDGER_COLUMN.entry, LEDGER_COLUMN.source, LEDGER_COLUMN.amount],
  audit: [LEDGER_COLUMN.date, LEDGER_COLUMN.id, LEDGER_COLUMN.entry, LEDGER_COLUMN.source, LEDGER_COLUMN.reference, LEDGER_COLUMN.amount],
};

/** The columns the chooser offers: every one a person can see, but not the download's own. */
export const CHOOSABLE_COLUMNS = [
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
  LEDGER_COLUMN.debit,
  LEDGER_COLUMN.credit,
] as const;

const entryOf = (params: ValueGetterParams<LedgerGridRow>): LedgerRow | null => (isEntry(params.data) ? params.data : null);

/** A day typed or picked in the date filter against an entry's calendar day, both read as a day with no time zone. */
export function compareDay(filterDate: Date, isoDay: string | null): number {
  if (!isoDay) return -1;
  const [year = 0, month = 1, day = 1] = isoDay.split("-").map(Number);
  const entryDay = new Date(year, month - 1, day);
  return Math.sign(entryDay.getTime() - filterDate.getTime());
}

/** What a person types in the amount filter, as whole cents read from its digits alone (never through a float). */
export function centsFromTyped(text: string | null, currency: string): number | null {
  if (text === null) return null;
  try {
    return centsFromDecimal(text.trim().replace(",", "."), currency);
  } catch (error) {
    if (error instanceof InvalidDecimalError) return null;
    throw error;
  }
}

/**
 * The ledger's columns. Every column sorts and has a floating filter: dates
 * by calendar day, amounts by exact cents typed as money, the rest as text.
 * Which show at first depends on the screen; the person chooses the rest.
 */
export function ledgerColumns({ variant, record, grid, currency, format }: LedgerColumnsInput): ColDef<LedgerGridRow>[] {
  const hidden = (colId: string) => !SHOWN[variant].includes(colId);

  const text = (colId: string, headerName: string, valueGetter: (row: LedgerRow) => string, extra: ColDef<LedgerGridRow> = {}): ColDef<LedgerGridRow> => ({
    colId,
    headerName,
    hide: hidden(colId),
    valueGetter: (params) => {
      const row = entryOf(params);
      return row ? valueGetter(row) : null;
    },
    filter: "agTextColumnFilter",
    floatingFilter: true,
    cellDataType: "text",
    width: 170,
    ...extra,
  });

  const money = (colId: string, headerName: string, field: "debitCents" | "creditCents"): ColDef<LedgerGridRow> => ({
    colId,
    field,
    headerName,
    hide: hidden(colId),
    type: "rightAligned",
    width: 170,
    cellDataType: false,
    valueFormatter: ({ value }) => (typeof value === "number" ? format.money(value) : ""),
    filter: "agNumberColumnFilter",
    floatingFilter: true,
    filterParams: moneyFilter(currency),
  });

  return [
    {
      colId: LEDGER_COLUMN.date,
      field: "isoDay",
      headerName: record.columns.date,
      hide: hidden(LEDGER_COLUMN.date),
      cellRenderer: DayCell,
      sort: "desc",
      width: 160,
      cellDataType: false,
      filter: "agDateColumnFilter",
      floatingFilter: true,
      filterParams: { comparator: compareDay },
      suppressMovable: true,
    },
    text(LEDGER_COLUMN.entry, record.columns.entry, (row) => row.text, {
      cellRenderer: EntryCell,
      flex: 2,
      minWidth: 210,
      width: undefined,
      tooltip: (params) => (isEntry(params.data) ? params.data.text : undefined),
      getQuickFilterText: (params) => (isEntry(params.data) ? searchTextOf(params.data) : ""),
    }),
    text(LEDGER_COLUMN.kind, grid.columns.kind, (row) => row.kind),
    text(LEDGER_COLUMN.person, grid.columns.person, (row) => row.person.label),
    text(LEDGER_COLUMN.category, grid.columns.category, (row) => row.category.label),
    text(LEDGER_COLUMN.source, record.columns.source, (row) => row.source, { width: 140 }),
    text(LEDGER_COLUMN.reference, grid.columns.reference, (row) => row.sourceId, { width: 210, flex: variant === "audit" ? 1 : undefined, minWidth: 170 }),
    text(LEDGER_COLUMN.id, grid.columns.entryId, (row) => row.id, { width: 210, flex: variant === "audit" ? 1 : undefined, minWidth: 170 }),
    text(LEDGER_COLUMN.reverses, grid.columns.reverses, (row) => row.reverses ?? "", { width: 210 }),
    {
      colId: LEDGER_COLUMN.amount,
      field: "cents",
      headerName: record.columns.amount,
      hide: hidden(LEDGER_COLUMN.amount),
      cellRenderer: AmountCell,
      type: "rightAligned",
      width: 170,
      // The amount is what the eye looks for, so it stays in view when the other columns scroll.
      pinned: "right",
      lockPinned: true,
      cellDataType: false,
      filter: "agNumberColumnFilter",
      floatingFilter: true,
      filterParams: moneyFilter(currency),
    },
    money(LEDGER_COLUMN.debit, grid.columns.debit, "debitCents"),
    money(LEDGER_COLUMN.credit, grid.columns.credit, "creditCents"),
    // Only in the download: what the entry did to the pool, signed.
    { colId: LEDGER_COLUMN.effect, headerName: grid.columns.effect, hide: true, filter: false, sortable: false },
  ];
}

function moneyFilter(currency: string) {
  return {
    numberParser: (typed: string | null) => centsFromTyped(typed, currency),
    numberFormatter: (cents: number | null) => (cents === null ? null : decimalAmount({ cents, currency })),
  };
}
