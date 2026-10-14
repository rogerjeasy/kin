import { exampleFamily } from "@/content/example-family";
import type { Dictionary } from "@/i18n/dictionary";
import { numberLocaleOf, type Locale } from "@/i18n/locales";

const dots = ["bg-share-1", "bg-share-2", "bg-share-3"] as const;

type ShareLegendProps = {
  locale: Locale;
  people: Dictionary["common"]["people"];
};

/** Names each colour on the ring, so the shares never depend on colour alone. */
export function ShareLegend({ locale, people }: ShareLegendProps) {
  const percent = new Intl.NumberFormat(numberLocaleOf(locale), { style: "unit", unit: "percent" });

  return (
    <ul className="flex flex-wrap justify-center gap-2">
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
