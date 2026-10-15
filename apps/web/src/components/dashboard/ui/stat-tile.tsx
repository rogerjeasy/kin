import type { LucideIcon } from "lucide-react";

type StatTileProps = { label: string; value: string; note: string; icon: LucideIcon };

/** One headline figure, with what it means underneath. */
export function StatTile({ label, value, note, icon: Icon }: StatTileProps) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
      <dt className="flex items-center justify-between gap-3 text-sm font-medium text-muted-foreground">
        <span className="min-w-0">{label}</span>
        <Icon aria-hidden="true" className="size-4.5 shrink-0" />
      </dt>
      <dd className="mt-3 min-w-0 text-2xl font-semibold sm:text-3xl tracking-tight break-words tabular-nums">{value}</dd>
      <dd className="mt-1.5 text-sm text-muted-foreground">{note}</dd>
    </div>
  );
}
