"use client";

import type { ColDef } from "ag-grid-community";
import { useMemo } from "react";

import { DataGrid, type GridCopy } from "@/components/data-grid/data-grid";
import type { Locale } from "@/i18n/locales";
import { formatters } from "@/lib/format";

export type YearRow = {
  /** `YYYY-MM`, or the year for the total row. */
  readonly id: string;
  readonly month: string;
  readonly paidInCents: number;
  readonly spentCents: number;
  readonly caregiverCents: number;
};

type YearGridProps = {
  label: string;
  copy: GridCopy;
  rtl: boolean;
  locale: Locale;
  currency: string;
  headers: { month: string; paidIn: string; spent: string; caregiver: string };
  rows: readonly YearRow[];
  /** The year's own totals, as the money core worked them out. */
  total: YearRow;
};

/**
 * The year in review as a grid on a wide screen: sort any column, and the
 * year's total pinned at the foot. The totals are the money core's, not
 * summed here. On a phone the page shows stacked cards instead.
 */
export function YearGrid({ label, copy, rtl, locale, currency, headers, rows, total }: YearGridProps) {
  const format = useMemo(() => formatters(locale, currency), [locale, currency]);
  const columns = useMemo<ColDef<YearRow>[]>(() => {
    const money = (colId: keyof YearRow, headerName: string): ColDef<YearRow> => ({
      colId,
      field: colId,
      headerName,
      type: "rightAligned",
      flex: 1,
      minWidth: 140,
      valueFormatter: ({ value }) => (typeof value === "number" ? format.money(value) : ""),
      cellClassRules: { "font-semibold": (params) => params.node?.rowPinned === "bottom" },
    });
    return [
      { colId: "month", field: "month", headerName: headers.month, flex: 1, minWidth: 160, comparator: (_a, _b, nodeA, nodeB) => nodeA.data?.id.localeCompare(nodeB.data?.id ?? "") ?? 0, cellClassRules: { "font-semibold": (params) => params.node?.rowPinned === "bottom" } },
      money("paidInCents", headers.paidIn),
      money("spentCents", headers.spent),
      money("caregiverCents", headers.caregiver),
    ];
  }, [headers, format]);

  return (
    <DataGrid<YearRow>
      label={label}
      copy={copy}
      rtl={rtl}
      rowData={rows as YearRow[]}
      columnDefs={columns}
      defaultColDef={{ sortable: true, cellDataType: false }}
      pinnedBottomRowData={[total]}
      getRowId={({ data }) => data.id}
    />
  );
}
