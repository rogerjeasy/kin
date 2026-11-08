import type { GridCopy } from "@/components/data-grid/data-grid";
import { FlowAmount } from "@/components/dashboard/ui/flow-amount";
import type { Dictionary } from "@/i18n/dictionary";

import { EntryFacts } from "./entry-facts";
import { EntryLines } from "./entry-lines";
import type { LedgerRow } from "./ledger-row.ts";

type EntryDetailProps = { item: LedgerRow | null; copy: Dictionary["dashboard"]["record"]; grid: GridCopy };

/** The selected entry in full: what it was, where it came from and its proof, and its balanced lines. */
export function EntryDetail({ item, copy, grid }: EntryDetailProps) {
  return (
    <section aria-labelledby="entry-detail-heading" aria-live="polite" className="min-w-0 rounded-xl bg-muted p-5">
      <h3 id="entry-detail-heading" className="text-sm font-semibold text-muted-foreground">
        {copy.grid.detailTitle}
      </h3>
      {item ? (
        <>
          <p className="mt-3 text-lg font-semibold text-pretty">{item.text}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {item.day} · {item.kind}
          </p>
          <p className="mt-3">
            <FlowAmount amount={item.amount} flow={item.flow} className="text-xl" />
          </p>
          {item.note ? <p className="text-sm text-muted-foreground">{item.note}</p> : null}
          <div className="mt-4">
            <EntryFacts item={item} copy={grid.detail} />
          </div>
          <div className="mt-4 rounded-lg bg-card px-4 py-2">
            <EntryLines caption={`${copy.lines.show}: ${item.text}`} headers={copy.lines} lines={item.lines} />
          </div>
        </>
      ) : (
        <p className="mt-3 text-muted-foreground">{copy.grid.hint}</p>
      )}
    </section>
  );
}
