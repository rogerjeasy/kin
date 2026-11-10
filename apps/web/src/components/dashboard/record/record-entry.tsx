import { ChevronDownIcon } from "lucide-react";

import type { GridCopy } from "@/components/data-grid/data-grid";
import { FlowAmount } from "@/components/dashboard/ui/flow-amount";

import { EntryFacts } from "./entry-facts";
import { EntryLines, type EntryLineRow } from "./entry-lines";
import type { LedgerRow } from "./ledger-row.ts";

export type RecordEntryItem = {
  id: string;
  day: string;
  text: string;
  kind: string;
  source: string;
  amount: string;
  flow: "in" | "out" | "none";
  /** Under the amount: PayPal's fee, or that care time is not cash. */
  note: string | null;
  tags: readonly string[];
  lines: readonly EntryLineRow[];
};

type RecordEntryProps = {
  item: LedgerRow;
  copy: { show: string; account: string; debit: string; credit: string };
  grid: GridCopy;
};

/** One ledger entry on a phone, which opens to show its lines. */
export function RecordEntry({ item, copy, grid }: RecordEntryProps) {
  return (
    <details className="group">
      <summary className="grid cursor-pointer list-none grid-cols-[3.5rem_minmax(0,1fr)_auto] items-start gap-x-3 px-5 py-4 transition-colors duration-300 group-open:bg-muted/50 hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <span className="pt-0.5 text-sm text-muted-foreground tabular-nums">{item.day}</span>
        <span className="min-w-0">
          <span className="block font-medium text-pretty">{item.text}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <span>{item.kind}</span>
            <span>· {item.source}</span>
            {item.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                {tag}
              </span>
            ))}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <FlowAmount amount={item.amount} flow={item.flow} />
          {item.note ? <span className="text-xs whitespace-nowrap text-muted-foreground">{item.note}</span> : null}
          <ChevronDownIcon aria-hidden="true" className="size-4 text-muted-foreground transition-transform duration-300 ease-(--ease-out-expo) group-open:rotate-180" />
        </span>
      </summary>
      <div className="enter px-5 pb-4">
        <div className="mb-3">
          <EntryFacts item={item} copy={grid.detail} />
        </div>
        <div className="rounded-2xl border bg-muted/60 px-4 py-2">
          <EntryLines caption={`${copy.show}: ${item.text}`} headers={copy} lines={item.lines} />
        </div>
      </div>
    </details>
  );
}
