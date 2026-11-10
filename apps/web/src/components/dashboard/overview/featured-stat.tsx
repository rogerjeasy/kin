import type { LucideIcon } from "lucide-react";

import { KnotMark } from "@/components/brand/knot-mark";
import { RisingFigure } from "@/components/motion/rising-figure";

type FeaturedStatProps = { label: string; value: string; note: string; icon: LucideIcon };

/**
 * The one figure the family looks for first: the pool, on an ink panel lit
 * from within, with the Kin knot turning slowly behind it.
 */
export function FeaturedStat({ label, value, note, icon: Icon }: FeaturedStatProps) {
  const theme = { "data-theme": "dark" };

  return (
    <div {...theme} className="aurora relative flex min-w-0 flex-col overflow-clip rounded-3xl border border-band-border p-5 text-foreground shadow-lg sm:p-6">
      <KnotMark className="pointer-events-none absolute end-3 bottom-3 size-28 opacity-15 motion-safe:animate-spin-slow [&_g]:stroke-band-highlight sm:size-32" />
      <dt className="flex items-center justify-between gap-3 text-sm font-medium text-muted-foreground">
        <span className="min-w-0">{label}</span>
        <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-highlight text-band shadow-[0_0_18px_2px_rgb(var(--glow-gold)/0.45)]">
          <Icon className="size-4" />
        </span>
      </dt>
      <dd className="mt-4 min-w-0 font-serif text-4xl tracking-tight break-words text-highlight tabular-nums sm:text-5xl">
        <RisingFigure value={value} />
      </dd>
      <dd className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden="true" className="relative inline-flex size-2">
          <span className="absolute inset-0 rounded-full bg-positive opacity-60 motion-safe:animate-dot-ping" />
          <span className="relative size-2 rounded-full bg-positive" />
        </span>
        {note}
      </dd>
    </div>
  );
}
