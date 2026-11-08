import type { MovementTotals } from "@kin/domain";

import type { GridCopy } from "@/components/data-grid/data-grid";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import { cn } from "@/lib/utils";

type SectionSummaryProps = {
  /** A group's subtotal, or the total of everything shown. */
  variant: "group" | "total";
  label: string;
  totals: MovementTotals;
  /** The debits and credits of what is shown, which are always equal. */
  balance?: { debitCents: number; creditCents: number };
  format: Formatters;
  copy: GridCopy["totals"];
  className?: string;
};

/**
 * One line of figures under a heading: how many entries, and what they did to
 * the pool. The grid's full-width rows and the phone's cards both draw it, so
 * the two never disagree. Amounts are shown from integer cents.
 */
export function SectionSummary({ variant, label, totals, balance, format, copy, className }: SectionSummaryProps) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1 text-sm", className)}>
      <span className="font-semibold text-pretty">{label}</span>
      <span className="text-muted-foreground">{fill(copy.entries, { count: format.count(totals.count) })}</span>
      {variant === "total" ? (
        <>
          <span className="text-muted-foreground tabular-nums">
            {copy.in}: <span className="font-medium text-positive">{format.money(totals.inCents)}</span>
          </span>
          <span className="text-muted-foreground tabular-nums">
            {copy.out}: <span className="font-medium text-foreground">{format.money(totals.outCents)}</span>
          </span>
        </>
      ) : null}
      <span className="font-semibold whitespace-nowrap tabular-nums">
        {copy.net}: {format.money(totals.netCents)}
      </span>
      {balance ? (
        <span className="text-muted-foreground tabular-nums">
          {copy.debits}: {format.money(balance.debitCents)} · {copy.credits}: {format.money(balance.creditCents)}
          {balance.debitCents === balance.creditCents ? ` · ${copy.balanced}` : ""}
        </span>
      ) : null}
    </div>
  );
}
