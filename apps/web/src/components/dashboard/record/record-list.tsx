"use client";

import { useMemo, useState } from "react";

import type { GridCopy } from "@/components/data-grid/data-grid";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

import type { LedgerRow, LedgerVariant } from "./ledger-row.ts";
import { LedgerToolbar } from "./ledger-toolbar";
import { RecordCards } from "./record-cards";
import { RecordFilterPills } from "./record-filter-pills";
import type { RecordFilter } from "./record-filters";
import { RecordGrid } from "./record-grid";
import { useLedgerView } from "./use-ledger-view";

type RecordListProps = {
  variant: LedgerVariant;
  copy: Dictionary["dashboard"]["record"];
  grid: GridCopy;
  items: readonly LedgerRow[];
  rtl: boolean;
  locale: Locale;
  currency: string;
  circleName: string;
  /** The day the screen was made on the circle's clock, `YYYY-MM-DD`. */
  generatedOn: string;
  /** Where this person's view of this circle is remembered. */
  storageKey: string;
  fileName: string;
};

/**
 * The month's entries under one row of kind filters and one toolbar: a grid
 * on a wide screen and, on a phone, the same rows as cards. Both read from one
 * grid, so the search, grouping, totals and download are the same on both.
 */
export function RecordList({ variant, copy, grid, items, rtl, locale, currency, circleName, generatedOn, storageKey, fileName }: RecordListProps) {
  const [filter, setFilter] = useState<RecordFilter>("all");
  const shown = useMemo(() => (filter === "all" ? items : items.filter((item) => item.filter === filter)), [items, filter]);
  const view = useLedgerView({ variant, rows: shown, entryCount: items.length, record: copy, grid, locale, currency, circleName, generatedOn, storageKey, fileName });

  return (
    <>
      {variant === "record" ? <RecordFilterPills copy={copy.filters} value={filter} onChange={setFilter} /> : null}
      <LedgerToolbar view={view} copy={grid} total={shown.length} />
      <div className="hidden md:block">
        <RecordGrid variant={variant} view={view} record={copy} grid={grid} rtl={rtl} rows={shown} />
      </div>
      <div className="md:hidden">
        <RecordCards view={view} record={copy} grid={grid} available={shown.length} />
      </div>
    </>
  );
}
