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
 * The look-back as a grid on a wide screen, sortable and filterable by
 * keyboard; on a phone the same rows are stacked cards, so nothing is squeezed
 * or scrolled sideways.
 */
export function LookbackGrid({ rows, copy, grid, rtl }: Props) {
  const columns = useMemo<ColDef<LookbackScreenRow>[]>(
    () => [
      { field: "day", headerName: copy.cols.day, width: 130 },
      { field: "to", headerName: copy.cols.to, flex: 1, minWidth: 140, wrapText: true, autoHeight: true },
      { field: "kind", headerName: copy.cols.kind, flex: 1, minWidth: 150, wrapText: true, autoHeight: true },
      { field: "amount", headerName: copy.cols.amount, width: 130, type: "rightAligned" },
      {
        field: "statusLabel",
        headerName: copy.cols.status,
        width: 190,
        cellRenderer: ({ data }: { data?: LookbackScreenRow }) => (data ? <StatusPill tone={TONES[data.status]}>{data.statusLabel}</StatusPill> : null),
      },
      { field: "why", headerName: copy.cols.why, flex: 2, minWidth: 260, wrapText: true, autoHeight: true, valueFormatter: ({ value }: { value?: readonly string[] }) => (value ?? []).join(" ") },
    ],
    [copy],
  );
  return (
    <>
      <div className="hidden px-5 pb-5 sm:px-6 md:block">
        <DataGrid<LookbackScreenRow> label={copy.grid} copy={grid} rtl={rtl} rowData={[...rows]} columnDefs={columns} getRowId={({ data }) => data.id} defaultColDef={{ sortable: true, resizable: true }} empty={{ title: copy.empty }} />
      </div>
      <ul aria-label={copy.grid} className="divide-y border-t md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="space-y-1.5 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-medium wrap-anywhere">{row.to}</p>
              <p className="shrink-0 font-semibold tabular-nums">{row.amount}</p>
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
