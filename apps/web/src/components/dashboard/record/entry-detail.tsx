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
    <section aria-labelledby="entry-detail-heading" aria-live="polite" className="surface min-w-0 overflow-clip rounded-3xl p-5">
      {/* A gold rule along the top: this panel follows the row the reader is on. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-gold/80 shadow-[0_0_12px_2px_rgb(var(--glow-gold)/0.5)]" />
      <h3 id="entry-detail-heading" className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {copy.grid.detailTitle}
      </h3>
      {item ? (
        <div key={item.id} className="enter">
          <p className="mt-3 text-lg font-semibold tracking-tight text-pretty">{item.text}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {item.day} · {item.kind}
          </p>
          <p className="mt-3">
            <FlowAmount amount={item.amount} flow={item.flow} className="font-serif text-3xl font-normal tracking-tight" />
          </p>
          {item.note ? <p className="text-sm text-muted-foreground">{item.note}</p> : null}
          <div className="mt-4">
            <EntryFacts item={item} copy={grid.detail} />
          </div>
          <div className="mt-4 rounded-2xl border bg-muted/60 px-4 py-2">
            <EntryLines caption={`${copy.lines.show}: ${item.text}`} headers={copy.lines} lines={item.lines} />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-muted-foreground">{copy.grid.hint}</p>
      )}
    </section>
  );
}
