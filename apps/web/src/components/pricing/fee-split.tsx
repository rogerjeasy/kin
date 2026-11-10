import { ShareBar } from "@/components/shared/share-bar";
import { ShareLegend } from "@/components/shared/share-legend";
import { exampleShares } from "@/content/example-family";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

type FeeSplitProps = {
  locale: Locale;
  copy: Dictionary["pricingPage"]["split"];
  people: Dictionary["common"]["people"];
};

/** Kin's own price, cut by the same shares as every other cost. */
export function FeeSplit({ locale, copy, people }: FeeSplitProps) {
  return (
    <div className="surface grid items-center gap-8 rounded-3xl p-6 shadow-md sm:p-9 lg:grid-cols-2 lg:gap-16">
      <div className="min-w-0">
        <h2 className="font-serif text-subtitle text-balance">{copy.title}</h2>
        <p className="mt-3 max-w-xl text-lg text-muted-foreground">{copy.text}</p>
      </div>
      <div className="min-w-0 space-y-4 rounded-2xl border bg-background/60 p-5">
        <ShareBar label={copy.barLabel} shares={exampleShares(people)} />
        <ShareLegend locale={locale} shares={exampleShares(people)} align="start" />
      </div>
    </div>
  );
}
