"use client";

import type { ColDef, ColumnVisibleEvent, GridApi, GridReadyEvent, IRowNode, PostSortRowsParams, RowSelectionOptions, SelectionChangedEvent, SortChangedEvent, StateUpdatedEvent } from "ag-grid-community";
import { movementTotals, type MovementTotals } from "@kin/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GridCopy } from "@/components/data-grid/data-grid";
import { downloadCsv } from "@/components/data-grid/download-csv";
import { browserStorage, pickGridState, readView, writeView, type StoredView } from "@/components/data-grid/grid-view-storage";
import { useAnnouncer } from "@/components/data-grid/use-announcer";
import type { Dictionary } from "@/i18n/dictionary";
import { numberLocaleOf, type Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";

import { ledgerColumns } from "./ledger-columns";
import { ledgerCsvParams } from "./ledger-export.ts";
import { arrangeLedger, compareGroups, groupHeaders } from "./ledger-groups.ts";
import { GROUP_BYS, isEntry, type GroupBy, type LedgerGridRow, type LedgerRow, type LedgerTotalRow, type LedgerVariant } from "./ledger-row.ts";
import { LedgerSectionRow, SECTION_ROW_HEIGHT, type LedgerGridContext } from "./ledger-section-row";
import { createLedgerStore, plainSnapshot, useLedgerSnapshot } from "./ledger-store.ts";

const ENTRY_ROW_HEIGHT = 68;
const TOTAL_ROW: LedgerTotalRow = { rowKind: "total", id: "total" };
const TOTAL_ROWS = [TOTAL_ROW];

const ROW_SELECTION: RowSelectionOptions<LedgerGridRow> = {
  mode: "multiRow",
  checkboxes: true,
  headerCheckbox: true,
  selectAll: "filtered",
  enableClickSelection: false,
  hideDisabledCheckboxes: true,
  isRowSelectable: (node: IRowNode<LedgerGridRow>) => isEntry(node.data),
};

const DEFAULT_COL_DEF: ColDef<LedgerGridRow> = { sortable: true, resizable: true };

// Headings are rows too, so no filter may remove one; a heading with nothing under it is dropped after sorting.
const alwaysPassFilter = (node: IRowNode<LedgerGridRow>) => node.data?.rowKind === "group";
const isFullWidthRow = ({ rowNode }: { rowNode: IRowNode<LedgerGridRow> }) => !isEntry(rowNode.data);
const getRowId = ({ data }: { data: LedgerGridRow }) => data.id;
const getRowHeight = ({ data }: { data: LedgerGridRow | undefined }) => (data?.rowKind === "group" ? SECTION_ROW_HEIGHT.group : data?.rowKind === "total" ? SECTION_ROW_HEIGHT.total : ENTRY_ROW_HEIGHT);

const asGroupBy = (value: string): GroupBy => GROUP_BYS.find((each) => each === value) ?? "none";

type LedgerViewInput = {
  variant: LedgerVariant;
  /** The entries to show, after the filter pills. */
  rows: readonly LedgerRow[];
  /** All the entries of the record, for "N of M". */
  entryCount: number;
  record: Dictionary["dashboard"]["record"];
  grid: GridCopy;
  locale: Locale;
  currency: string;
  circleName: string;
  /** The day the screen was made, from the circle's clock. */
  generatedOn: string;
  /** Where this person's view is remembered, per circle and member. */
  storageKey: string;
  fileName: string;
};

/**
 * Everything the Record screen does with its grid beyond drawing it: the
 * search and grouping, the person's remembered view, the totals of what is
 * shown and of what is selected, the column chooser, the CSV of the view, and
 * what a screen reader is told as each of them changes. The grid is the one
 * source of truth: the phone's cards read the rows the grid is showing.
 */
export function useLedgerView({ variant, rows, entryCount, record, grid, locale, currency, circleName, generatedOn, storageKey, fileName }: LedgerViewInput) {
  const apiRef = useRef<GridApi<LedgerGridRow> | null>(null);
  const [store] = useState(() => createLedgerStore(plainSnapshot(rows)));
  const snapshot = useLedgerSnapshot(store);
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  // `undefined` until the stored view has been read: the grid starts from it, so it waits.
  const [stored, setStored] = useState<StoredView | null | undefined>(undefined);
  const [selection, setSelection] = useState<MovementTotals | null>(null);
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const { message, announce } = useAnnouncer();
  const format = useMemo(() => formatters(locale, currency), [locale, currency]);
  const ready = stored !== undefined;

  useEffect(() => {
    const view = readView(browserStorage(), storageKey);
    if (view) {
      setQuery(view.query);
      setGroupBy(asGroupBy(view.groupBy));
    }
    setStored(view);
  }, [storageKey]);

  const persist = useCallback(
    (gridState: unknown) => {
      writeView(browserStorage(), storageKey, { grid: pickGridState(gridState), query, groupBy });
    },
    [storageKey, query, groupBy],
  );

  // A search or a grouping changes no grid state, so it is saved on its own.
  useEffect(() => {
    const api = apiRef.current;
    if (ready && api) persist(api.getState());
  }, [ready, persist]);

  const seen = useRef({ count: -1, groupBy });
  useEffect(() => {
    if (!ready) return;
    if (seen.current.groupBy !== groupBy) {
      announce(groupBy === "none" ? grid.live.ungrouped : fill(grid.live.grouped, { group: grid.toolbar.groups[groupBy] }));
    }
    if (seen.current.count !== snapshot.overall.count) {
      announce(fill(grid.live.shown, { shown: format.count(snapshot.overall.count), total: format.count(rows.length) }));
    }
    seen.current = { count: snapshot.overall.count, groupBy };
  }, [ready, groupBy, snapshot.overall.count, rows.length, announce, grid, format]);

  const rowData = useMemo<LedgerGridRow[]>(() => (groupBy === "none" ? [...rows] : [...groupHeaders(rows, groupBy), ...rows]), [rows, groupBy]);
  const columnDefs = useMemo(() => ledgerColumns({ variant, record, grid, currency, format }), [variant, record, grid, currency, format]);
  const context = useMemo<LedgerGridContext>(() => ({ store, format, copy: grid, showBalance: variant === "audit" }), [store, format, grid, variant]);

  const compare = useMemo(() => (groupBy === "none" ? () => 0 : compareGroups(groupBy, numberLocaleOf(locale))), [groupBy, locale]);
  const postSortRows = useCallback(
    ({ nodes }: PostSortRowsParams<LedgerGridRow>) => {
      const arranged = arrangeLedger(nodes, groupBy, (node) => node.data, compare);
      // The grid reads this same array next, so it is rearranged where it stands.
      nodes.splice(0, nodes.length, ...arranged.nodes);
      store.set({ rows: arranged.nodes.flatMap((node) => (node.data ? [node.data] : [])), sections: arranged.sections, overall: arranged.overall });
    },
    [groupBy, compare, store],
  );

  const readColumns = useCallback((api: GridApi<LedgerGridRow>) => setHidden(api.getColumnState().flatMap((column) => (column.hide ? [column.colId] : []))), []);

  const onGridReady = useCallback(
    (event: GridReadyEvent<LedgerGridRow>) => {
      apiRef.current = event.api;
      readColumns(event.api);
    },
    [readColumns],
  );
  const onStateUpdated = useCallback((event: StateUpdatedEvent<LedgerGridRow>) => persist(event.state), [persist]);
  const onColumnVisible = useCallback((event: ColumnVisibleEvent<LedgerGridRow>) => readColumns(event.api), [readColumns]);
  const onSelectionChanged = useCallback((event: SelectionChangedEvent<LedgerGridRow>) => {
    const selected = event.api.getSelectedRows().filter(isEntry);
    setSelection(selected.length === 0 ? null : movementTotals(selected));
  }, []);
  const onSortChanged = useCallback(
    (event: SortChangedEvent<LedgerGridRow>) => {
      const sorted = event.api.getColumnState().filter((column) => column.sort).toSorted((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
      const first = sorted[0];
      const name = first ? event.api.getColumn(first.colId)?.getColDef().headerName : undefined;
      announce(first && name ? fill(grid.live.sorted, { column: name, direction: first.sort === "asc" ? grid.live.ascending : grid.live.descending }) : grid.live.unsorted);
    },
    [announce, grid],
  );

  // Every option is stable between renders: the grid treats a new function as a changed option and refreshes its rows.
  const gridProps = {
    rowData,
    columnDefs,
    defaultColDef: DEFAULT_COL_DEF,
    context,
    initialState: stored?.grid,
    quickFilterText: query,
    includeHiddenColumnsInQuickFilter: true,
    pinnedBottomRowData: TOTAL_ROWS,
    rowSelection: ROW_SELECTION,
    postSortRows,
    alwaysPassFilter,
    isFullWidthRow,
    fullWidthCellRenderer: LedgerSectionRow,
    getRowId,
    getRowHeight,
    onGridReady,
    onStateUpdated,
    onColumnVisible,
    onSelectionChanged,
    onSortChanged,
  };

  /** Writes the entries on screen, in the order shown, to a file the spreadsheet opens. */
  function exportCsv() {
    const api = apiRef.current;
    if (!api) return;
    const csv = api.getDataAsCsv(ledgerCsvParams({ currency, circleName, generatedOn, copy: { ...grid.csv }, shown: snapshot.overall, entryCount }));
    if (csv === undefined) return;
    downloadCsv(fileName, csv);
    announce(grid.live.exported);
  }

  /** Puts the grid back as it was built: no search, filter, grouping or sort, and the first columns. */
  function reset() {
    const api = apiRef.current;
    api?.setFilterModel(null);
    api?.resetColumnState();
    setQuery("");
    setGroupBy("none");
    announce(grid.live.reset);
  }

  function setColumnVisible(columnId: string, visible: boolean) {
    apiRef.current?.setColumnsVisible([columnId], visible);
  }

  return { ready, query, setQuery, groupBy, setGroupBy, snapshot, store, selection, hidden, message, format, gridProps, exportCsv, reset, setColumnVisible, columnDefs };
}

export type LedgerView = ReturnType<typeof useLedgerView>;
