import { numberLocaleOf, type Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

import type { ShareSegment } from "./share-bar";
import { shareColorAt } from "./share-colors";

const alignments = { centre: "justify-center", start: "justify-start" } as const;

export type LegendShare = ShareSegment & { readonly name: string };

type ShareLegendProps = {
  locale: Locale;
  shares: readonly LegendShare[];
  align?: keyof typeof alignments;
};

/** Names each colour of the shares, so they never depend on colour alone. */
export function ShareLegend({ locale, shares, align = "centre" }: ShareLegendProps) {
  const percent = new Intl.NumberFormat(numberLocaleOf(locale), { style: "percent", maximumFractionDigits: 1 });
  return (
    <ul className={cn("flex flex-wrap gap-2", alignments[align])}>
      {shares.map((share, index) => (
        <li key={share.key} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${shareColorAt(index).dot}`} />
          <strong className="font-semibold">{share.name}</strong>
          <span className="text-muted-foreground tabular-nums">{percent.format(share.bps / 10_000)}</span>
        </li>
      ))}
    </ul>
  );
}
