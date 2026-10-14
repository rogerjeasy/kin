import { exampleFamily } from "@/content/example-family";
import type { Dictionary } from "@/i18n/dictionary";
import { numberLocaleOf, type Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

const dots = ["bg-share-1", "bg-share-2", "bg-share-3"] as const;

const alignments = { centre: "justify-center", start: "justify-start" } as const;

type ShareLegendProps = {
  locale: Locale;
  people: Dictionary["common"]["people"];
  align?: keyof typeof alignments;
};

/** Names each colour of the shares, so they never depend on colour alone. */
export function ShareLegend({ locale, people, align = "centre" }: ShareLegendProps) {
  const percent = new Intl.NumberFormat(numberLocaleOf(locale), { style: "unit", unit: "percent" });

  return (
    <ul className={cn("flex flex-wrap gap-2", alignments[align])}>
      {exampleFamily.shares.map((share, index) => (
        <li key={share.member} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${dots[index] ?? ""}`} />
          <strong className="font-semibold">{people[share.member]}</strong>
          <span className="text-muted-foreground tabular-nums">{percent.format(share.percent)}</span>
        </li>
      ))}
    </ul>
  );
}
