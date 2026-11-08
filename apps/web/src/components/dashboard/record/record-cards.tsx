import type { GridCopy } from "@/components/data-grid/data-grid";
import type { Dictionary } from "@/i18n/dictionary";

import { RecordEntry } from "./record-entry";
import { SectionSummary } from "./section-summary";
import type { LedgerView } from "./use-ledger-view";

type RecordCardsProps = {
  view: LedgerView;
  record: Dictionary["dashboard"]["record"];
  grid: GridCopy;
  /** How many entries there are before the search: none means the kind itself is empty. */
  available: number;
};

/**
 * The ledger on a phone, where a grid would be squeezed: the very rows the
 * grid is showing, as cards that open to their proof and their lines, under
 * the same search, grouping and totals.
 */
export function RecordCards({ view, record, grid, available }: RecordCardsProps) {
  const { rows, sections, overall } = view.snapshot;

  if (overall.count === 0) {
    return <p className="border-t px-5 py-8 text-center text-muted-foreground">{available === 0 ? record.empty : grid.states.noMatches}</p>;
  }

  return (
    <>
      <ul aria-label={record.grid.label} className="divide-y border-t">
        {rows.map((row) => {
          if (row.rowKind === "group") {
            const totals = sections.get(row.key);
            return totals ? (
              <li key={row.id} className="bg-muted px-5 py-3">
                <SectionSummary variant="group" label={row.label} totals={totals} format={view.format} copy={grid.totals} />
              </li>
            ) : null;
          }
          return row.rowKind === "entry" ? (
            <li key={row.id}>
              <RecordEntry item={row} copy={record.lines} grid={grid} />
            </li>
          ) : null;
        })}
      </ul>
      <div className="border-t bg-muted px-5 py-4">
        <SectionSummary variant="total" label={grid.totals.total} totals={overall} format={view.format} copy={grid.totals} />
      </div>
    </>
  );
}
