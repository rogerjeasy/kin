"use client";

import type { CellFocusedEvent, RowClickedEvent } from "ag-grid-community";
import { useState } from "react";

import { DataGrid, type GridCopy } from "@/components/data-grid/data-grid";
import type { Dictionary } from "@/i18n/dictionary";
import { cn } from "@/lib/utils";

import { EntryDetail } from "./entry-detail";
import { isEntry, type LedgerGridRow, type LedgerRow, type LedgerVariant } from "./ledger-row.ts";
import type { LedgerView } from "./use-ledger-view";

type RecordGridProps = {
  variant: LedgerVariant;
  view: LedgerView;
  record: Dictionary["dashboard"]["record"];
  grid: GridCopy;
  rtl: boolean;
  rows: readonly LedgerRow[];
};

/**
 * The ledger as a grid (AGENTS.md section 8): sortable, filterable, groupable
 * and fully usable by keyboard. Moving to a row, by click or by the arrow
 * keys, shows that entry's proof and its balanced lines beside the grid.
 * Ticking rows totals them in the toolbar instead.
 */
export function RecordGrid({ variant, view, record, grid, rtl, rows }: RecordGridProps) {
  const [detailId, setDetailId] = useState<string | null>(rows[0]?.id ?? null);
  const detail = rows.find((row) => row.id === detailId) ?? null;

  function show(data: LedgerGridRow | undefined) {
    if (isEntry(data)) setDetailId(data.id);
  }

  return (
    <div className={cn("grid gap-5 px-5 pb-5 sm:px-6", variant === "record" && "xl:grid-cols-[minmax(0,1fr)_20rem]")}>
      <DataGrid<LedgerGridRow>
        {...view.gridProps}
        label={record.grid.label}
        copy={grid}
        rtl={rtl}
        ready={view.ready}
        empty={{ title: record.empty }}
        onRowClicked={(event: RowClickedEvent<LedgerGridRow>) => show(event.data)}
        onCellFocused={(event: CellFocusedEvent<LedgerGridRow>) => {
          if (typeof event.rowIndex !== "number" || event.rowPinned) return;
          show(event.api.getDisplayedRowAtIndex(event.rowIndex)?.data);
        }}
      />
      {variant === "record" ? (
        <div className="min-w-0 xl:sticky xl:top-20 xl:self-start print:hidden">
          <EntryDetail item={detail} copy={record} grid={grid} />
        </div>
      ) : null}
    </div>
  );
}
