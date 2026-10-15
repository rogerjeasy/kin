import type { CustomCellRendererProps } from "ag-grid-react";

import { FlowAmount } from "@/components/dashboard/ui/flow-amount";

import type { RecordEntryItem } from "./record-entry";

type Cell = CustomCellRendererProps<RecordEntryItem>;

/** The entry's words, with its kind and labels under them. */
export function EntryCell({ data }: Cell) {
  if (!data) return null;
  return (
    <div className="flex h-full min-w-0 flex-col justify-center leading-snug">
      <span className="truncate font-medium">{data.text}</span>
      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <span className="truncate">{data.kind}</span>
        {data.tags.map((tag) => (
          <span key={tag} className="shrink-0 rounded-full bg-secondary px-2 text-xs font-medium leading-5">
            {tag}
          </span>
        ))}
      </span>
    </div>
  );
}

/** The amount with how it moved the pool, and its fee or care note. */
export function AmountCell({ data }: Cell) {
  if (!data) return null;
  return (
    <div className="flex h-full flex-col items-end justify-center leading-snug">
      <FlowAmount amount={data.amount} flow={data.flow} />
      {data.note ? <span className="text-xs text-muted-foreground">{data.note}</span> : null}
    </div>
  );
}

/** The day as the reader writes it. The column sorts by the calendar date behind it. */
export function DayCell({ data }: Cell) {
  return <span className="text-muted-foreground tabular-nums">{data?.day}</span>;
}
