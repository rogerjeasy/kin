import { DownloadIcon, RotateCcwIcon, SearchIcon } from "lucide-react";
import { useId, useMemo } from "react";

import type { GridCopy } from "@/components/data-grid/data-grid";
import { LiveRegion } from "@/components/data-grid/live-region";
import { Button } from "@/components/ui/button";
import { fill } from "@/i18n/template";

import { LedgerColumnsMenu } from "./ledger-columns-menu";
import { LedgerGroupSelect } from "./ledger-group-select";
import type { LedgerView } from "./use-ledger-view";

type LedgerToolbarProps = { view: LedgerView; copy: GridCopy; total: number };

/**
 * The controls over the ledger, the same on every screen size: search, group,
 * download and reset, and on a screen wide enough for the grid, the column
 * chooser. Under them, what is shown and what is selected, in words.
 */
export function LedgerToolbar({ view, copy, total }: LedgerToolbarProps) {
  const searchId = useId();
  const { toolbar } = copy;
  const names = useMemo(() => new Map(view.columnDefs.flatMap((column) => (column.colId && column.headerName ? [[column.colId, column.headerName] as const] : []))), [view.columnDefs]);

  return (
    <div className="px-5 pb-4 sm:px-6 print:hidden">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 grow basis-full flex-col gap-1 sm:basis-64">
          <label htmlFor={searchId} className="text-sm font-medium text-muted-foreground">
            {toolbar.search}
          </label>
          <div className="relative">
            <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id={searchId}
              type="search"
              value={view.query}
              onChange={(event) => view.setQuery(event.target.value)}
              placeholder={toolbar.searchPlaceholder}
              autoComplete="off"
              className="min-h-11 w-full rounded-full border border-input bg-card ps-9 pe-4 text-base shadow-2xs transition-[border-color,box-shadow] duration-300 focus-visible:border-gold focus-visible:shadow-[0_0_0_4px_rgb(var(--glow-gold)/0.16)]"
            />
          </div>
        </div>
        <LedgerGroupSelect value={view.groupBy} onChange={view.setGroupBy} copy={toolbar} />
        <div className="hidden md:block">
          <LedgerColumnsMenu copy={toolbar} hidden={view.hidden} names={names} onChange={view.setColumnVisible} />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={view.exportCsv} className="w-full sm:w-auto">
          <DownloadIcon aria-hidden="true" />
          {toolbar.export}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={view.reset} className="w-full sm:w-auto">
          <RotateCcwIcon aria-hidden="true" />
          {toolbar.reset}
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {fill(toolbar.shown, { shown: view.format.count(view.snapshot.overall.count), total: view.format.count(total) })}
        <span role="status" className="ms-3 font-medium text-foreground">
          {view.selection ? fill(toolbar.selected, { count: view.format.count(view.selection.count), amount: view.format.money(view.selection.netCents) }) : null}
        </span>
      </p>
      <LiveRegion message={view.message} />
    </div>
  );
}
