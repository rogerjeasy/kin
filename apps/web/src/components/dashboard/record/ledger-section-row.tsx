import type { CustomCellRendererProps } from "ag-grid-react";

import type { GridCopy } from "@/components/data-grid/data-grid";
import type { Formatters } from "@/lib/format";

import { sumCents } from "@kin/domain";

import { isEntry, type LedgerGridRow } from "./ledger-row.ts";
import { useLedgerSnapshot, type LedgerStore } from "./ledger-store.ts";
import { SectionSummary } from "./section-summary";

/** What the full-width rows need to draw themselves: the totals store, the words and the money formatter. */
export type LedgerGridContext = {
  readonly store: LedgerStore;
  readonly format: Formatters;
  readonly copy: GridCopy;
  /** The audit trail also shows that the debits and the credits of what is shown are equal. */
  readonly showBalance: boolean;
};

/**
 * A full-width row: a group's heading with its subtotal, or the pinned total
 * at the foot. It is a real grid row, so the keyboard reaches it in order and
 * a screen reader reads it as a row of its own.
 */
export function LedgerSectionRow(props: CustomCellRendererProps<LedgerGridRow, unknown, LedgerGridContext>) {
  // AG Grid draws a full-width row as a row with no cell in it; a row must hold cells to be read as one (WCAG 1.3.1).
  return (
    <div role="gridcell" className="h-full min-w-0">
      <SectionContent {...props} />
    </div>
  );
}

function SectionContent({ data, context }: CustomCellRendererProps<LedgerGridRow, unknown, LedgerGridContext>) {
  const { rows, sections, overall } = useLedgerSnapshot(context.store);
  if (data?.rowKind === "group") {
    const totals = sections.get(data.key);
    if (!totals) return null;
    return <SectionSummary variant="group" label={data.label} totals={totals} format={context.format} copy={context.copy.totals} className="h-full content-center bg-muted px-4" />;
  }
  if (data?.rowKind === "total") {
    const entries = rows.filter(isEntry);
    const balance = context.showBalance ? { debitCents: sumCents(entries.map((row) => row.debitCents)), creditCents: sumCents(entries.map((row) => row.creditCents)) } : undefined;
    return <SectionSummary variant="total" label={context.copy.totals.total} totals={overall} balance={balance} format={context.format} copy={context.copy.totals} className="h-full content-center border-t bg-muted px-4" />;
  }
  return null;
}

export const SECTION_ROW_HEIGHT = { group: 52, total: 84 } as const;
