"use client";

import type { GridReadyEvent } from "ag-grid-community";
import { AgGridProvider, AgGridReact, type AgGridReactProps } from "ag-grid-react";
import { useCallback, useId, useRef } from "react";

import type { Dictionary } from "@/i18n/dictionary";
import { cn } from "@/lib/utils";

import { GridEmptyOverlay } from "./grid-empty-overlay";
import { GridError } from "./grid-error";
import { gridModules } from "./grid-modules";
import { GridSkeleton } from "./grid-skeleton";
import { kinGridTheme } from "./grid-theme";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";
import { usePrintLayout } from "./use-print-layout";

export type GridCopy = Dictionary["dataGrid"];

/** The options Kin's grids all share are fixed here, so a screen cannot undo them by accident. */
type FixedOptions = "theme" | "localeText" | "enableRtl" | "animateRows" | "domLayout" | "suppressCellFocus" | "tabToNextCell" | "noRowsOverlayComponent" | "noRowsOverlayComponentParams";

type DataGridProps<TData> = Omit<AgGridReactProps<TData>, FixedOptions> & {
  /** Names the region and the grid for a screen reader. */
  label: string;
  copy: GridCopy;
  /** Arabic and Hebrew read right to left. */
  rtl: boolean;
  /** False while the screen reads what the grid starts from, such as the person's saved view. */
  ready?: boolean;
  /** True when the rows could not be read. */
  failed?: boolean;
  onRetry?: () => void;
  /** What an empty grid says, when the default ("nothing yet, here is what adds entries") would mislead. */
  empty?: { title: string; text?: string };
  className?: string;
};

/**
 * Kin's one AG Grid: its modules, theme (design tokens, so light and dark),
 * words in the reader's language, reading direction, keyboard behaviour and
 * the four states every data view has (loading, empty, error, rows).
 *
 * Keyboard: Tab enters the grid at the headers and again leaves it, so a
 * long list is never a long run of tab stops; arrow keys move between cells.
 * Motion follows the person's setting. For print it lays out every row and
 * column, so a printed page is never cut off at the edge of the screen.
 */
export function DataGrid<TData>({ label, copy, rtl, ready = true, failed = false, onRetry, empty, className, onGridReady, ...grid }: DataGridProps<TData>) {
  const hintId = useId();
  const region = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const printing = usePrintLayout();

  const handleReady = useCallback(
    (event: GridReadyEvent<TData>) => {
      // AG Grid names nothing on its own: the grid takes the region's name.
      region.current?.querySelector('[role="grid"]')?.setAttribute("aria-label", label);
      onGridReady?.(event);
    },
    [label, onGridReady],
  );

  return (
    <div ref={region} role="region" aria-label={label} aria-describedby={hintId} className={cn("min-w-0 overflow-hidden rounded-xl border print:overflow-visible print:rounded-none print:border-0", className)}>
      <p id={hintId} className="sr-only">
        {copy.hint}
      </p>
      {failed ? (
        <GridError title={copy.states.errorTitle} text={copy.states.errorText} retry={copy.states.retry} onRetry={onRetry} />
      ) : !ready ? (
        <GridSkeleton label={copy.states.loading} />
      ) : (
        <AgGridProvider modules={gridModules}>
          <AgGridReact<TData>
            {...grid}
            theme={kinGridTheme}
            localeText={copy.localeText}
            enableRtl={rtl}
            animateRows={!reducedMotion}
            domLayout={printing ? "print" : "autoHeight"}
            suppressCellFocus={false}
            tabToNextCell={() => false}
            noRowsOverlayComponent={GridEmptyOverlay}
            noRowsOverlayComponentParams={empty ?? { title: copy.states.emptyTitle, text: copy.states.emptyText }}
            onGridReady={handleReady}
          />
        </AgGridProvider>
      )}
    </div>
  );
}
