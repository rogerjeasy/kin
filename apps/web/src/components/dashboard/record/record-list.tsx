"use client";

import { useState } from "react";

import type { Dictionary } from "@/i18n/dictionary";
import { cn } from "@/lib/utils";

import { RecordEntry } from "./record-entry";
import { RECORD_FILTERS, type RecordFilter } from "./record-filters";
import { RecordGrid, type LedgerRow } from "./record-grid";

type RecordListProps = {
  copy: Dictionary["dashboard"]["record"];
  items: readonly (LedgerRow & { filter: RecordFilter })[];
  rtl: boolean;
};

/**
 * The month's entries under one row of filters: a grid on a wide screen, and
 * on a phone the same entries as cards that open to their lines.
 */
export function RecordList({ copy, items, rtl }: RecordListProps) {
  const [filter, setFilter] = useState<RecordFilter>("all");
  const shown = filter === "all" ? items : items.filter((item) => item.filter === filter);

  return (
    <>
      <div role="group" aria-label={copy.filters.label} className="flex flex-wrap gap-2 px-5 pb-4 sm:px-6">
        {RECORD_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
              filter === key ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {copy.filters[key]}
          </button>
        ))}
      </div>
      <div className="hidden md:block">
        <RecordGrid key={filter} copy={copy} rows={shown} rtl={rtl} />
      </div>
      <div className="md:hidden">
        {shown.length === 0 ? (
          <p className="border-t px-5 py-8 text-center text-muted-foreground">{copy.empty}</p>
        ) : (
          <ul aria-label={copy.grid.label} className="divide-y border-t">
            {shown.map((item) => (
              <li key={item.id}>
                <RecordEntry item={item} copy={copy.lines} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
