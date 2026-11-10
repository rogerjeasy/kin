import type { LucideIcon } from "lucide-react";

import { RisingFigure } from "@/components/motion/rising-figure";

type StatTileProps = { label: string; value: string; note: string; icon: LucideIcon };

/** One headline figure, with what it means underneath. */
export function StatTile({ label, value, note, icon: Icon }: StatTileProps) {
  return (
    <div className="surface lift group flex min-w-0 flex-col rounded-3xl p-4 sm:p-5">
      <dt className="flex items-center justify-between gap-3 text-sm font-medium text-muted-foreground">
        <span className="min-w-0">{label}</span>
        <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-[background-color,color,transform] duration-500 group-hover:rotate-[-8deg] group-hover:bg-primary group-hover:text-primary-foreground">
          <Icon className="size-4" />
        </span>
      </dt>
      <dd className="mt-4 min-w-0 font-serif text-3xl tracking-tight break-words tabular-nums sm:text-[2.125rem] sm:leading-tight">
        <RisingFigure value={value} />
      </dd>
      <dd className="mt-1.5 text-sm text-muted-foreground">{note}</dd>
    </div>
  );
}
