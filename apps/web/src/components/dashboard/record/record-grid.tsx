"use client";

import { CellStyleModule, ClientSideRowModelModule, RowApiModule, RowSelectionModule, ValidationModule, type ColDef, type GridApi } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useMemo, useRef, useState } from "react";

import type { Dictionary } from "@/i18n/dictionary";

import { AmountCell, DayCell, EntryCell } from "./entry-cells";
import { EntryDetail } from "./entry-detail";
import { ledgerGridTheme } from "./grid-theme";
import type { RecordEntryItem } from "./record-entry";

/**
 * Only what the ledger uses, to keep the page light. In development the
 * validation module explains, in words, any feature used without its module.
 */
const modules = [
  ClientSideRowModelModule,
  RowSelectionModule,
  RowApiModule,
  CellStyleModule,
  ...(process.env.NODE_ENV === "production" ? [] : [ValidationModule]),
];

export type LedgerRow = RecordEntryItem & { readonly isoDay: string; readonly cents: number };

type RecordGridProps = {
  copy: Dictionary["dashboard"]["record"];
  rows: readonly LedgerRow[];
  rtl: boolean;
};

/**
 * The ledger as a grid (AGENTS.md section 8): sortable by date and amount,
 * fully usable by keyboard. Selecting a row, by click or by moving to it with
 * the arrow keys, shows that entry's ledger lines beside the grid.
 */
export function RecordGrid({ copy, rows, rtl }: RecordGridProps) {
  const api = useRef<GridApi<LedgerRow> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const columns = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: "isoDay", headerName: copy.columns.date, cellRenderer: DayCell, sort: "desc", width: 104, suppressMovable: true },
      { field: "text", headerName: copy.columns.entry, cellRenderer: EntryCell, flex: 1, minWidth: 220, sortable: false, suppressMovable: true },
      { field: "source", headerName: copy.columns.source, width: 150, suppressMovable: true },
      { field: "cents", headerName: copy.columns.amount, cellRenderer: AmountCell, type: "rightAligned", width: 170, suppressMovable: true },
    ],
    [copy],
  );

  function select(id: string | undefined) {
    if (!id) return;
    setSelectedId(id);
    api.current?.getRowNode(id)?.setSelected(true, true);
  }

  return (
    <div className="grid gap-5 px-5 pb-5 sm:px-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div role="region" aria-label={copy.grid.label} className="min-w-0 overflow-hidden rounded-xl border">
        <AgGridProvider modules={modules}>
          <AgGridReact<LedgerRow>
            theme={ledgerGridTheme}
            rowData={rows as LedgerRow[]}
            columnDefs={columns}
            getRowId={({ data }) => data.id}
            domLayout="autoHeight"
            enableRtl={rtl}
            rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
            suppressCellFocus={false}
            overlayNoRowsTemplate={`<span>${escapeHtml(copy.empty)}</span>`}
            onGridReady={(event) => {
              api.current = event.api;
            }}
            onFirstDataRendered={() => select(selectedId ?? undefined)}
            onRowClicked={(event) => select(event.data?.id)}
            onCellFocused={(event) => {
              if (typeof event.rowIndex !== "number" || event.rowPinned) return;
              select(api.current?.getDisplayedRowAtIndex(event.rowIndex)?.data?.id);
            }}
          />
        </AgGridProvider>
      </div>
      <div className="min-w-0 xl:sticky xl:top-20 xl:self-start">
        <EntryDetail item={selected} copy={copy} />
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
