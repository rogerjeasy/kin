"use client";

import type { ColDef } from "ag-grid-community";
import { useMemo } from "react";

import { DataGrid, type GridCopy } from "@/components/data-grid/data-grid";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";

import type { LookbackScreenRow } from "./lookback-rows";

type Props = {
  rows: readonly LookbackScreenRow[];
  copy: Dictionary["dashboard"]["packet"]["lookback"];
  grid: GridCopy;
  rtl: boolean;
};

const TONES = { documented: "positive", needs_documentation: "waiting", reversed: "neutral" } as const;

/**
 * Every cell wraps with an ordinary line height and the same top padding, so
 * a second line sits under the first rather than a row away, and a row's
 * cells start on one line however many lines each one takes.
 */
const CELL = "py-3.5 leading-snug!";
const WRAPPED = { wrapText: true, autoHeight: true, cellClass: CELL } as const;

/**
 * The look-back as a grid on a wide screen, sortable and filterable by
 * keyboard; on a phone the same rows are stacked cards, so nothing is squeezed
 * or scrolled sideways.
 */
export function LookbackGrid({ rows, copy, grid, rtl }: Props) {
  const columns = useMemo<ColDef<LookbackScreenRow>[]>(
    () => [
      { field: "day", headerName: copy.cols.day, width: 130, ...WRAPPED, cellClass: `${CELL} text-muted-foreground tabular-nums` },
      { field: "to", headerName: copy.cols.to, flex: 1, minWidth: 140, ...WRAPPED },
      { field: "kind", headerName: copy.cols.kind, flex: 1, minWidth: 150, ...WRAPPED },
      { field: "amount", headerName: copy.cols.amount, width: 130, type: "rightAligned", ...WRAPPED, cellClass: `${CELL} ag-right-aligned-cell font-semibold tabular-nums` },
      {
        field: "statusLabel",
        headerName: copy.cols.status,
        width: 210,
        autoHeight: true,
        cellClass: "py-3 leading-snug!",
        cellRenderer: ({ data }: { data?: LookbackScreenRow }) => (data ? <StatusPill tone={TONES[data.status]}>{data.statusLabel}</StatusPill> : null),
      },
      { field: "why", headerName: copy.cols.why, flex: 2, minWidth: 260, ...WRAPPED, valueFormatter: ({ value }: { value?: readonly string[] }) => (value ?? []).join(" ") },
    ],
    [copy],
  );
  return (
    <>
      <div className="hidden px-5 pb-5 sm:px-6 md:block">
        <DataGrid<LookbackScreenRow> label={copy.grid} copy={grid} rtl={rtl} rowData={[...rows]} columnDefs={columns} getRowId={({ data }) => data.id} defaultColDef={{ sortable: true, resizable: true }} empty={{ title: copy.empty }} />
      </div>
      <ul aria-label={copy.grid} className="space-y-3 px-4 pb-4 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="space-y-2 rounded-2xl border bg-card p-4 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-medium wrap-anywhere">{row.to}</p>
              <p className="shrink-0 font-serif text-xl tabular-nums">{row.amount}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {row.day} · {row.kind}
            </p>
            <StatusPill tone={TONES[row.status]}>{row.statusLabel}</StatusPill>
            {row.why.map((line) => (
              <p key={line} className="text-sm text-pretty text-muted-foreground">
                {line}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}
