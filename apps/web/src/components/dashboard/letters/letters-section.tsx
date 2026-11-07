import type { CircleSnapshot } from "@kin/db";

import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

import { DemandCheck } from "./demand-check";
import { LetterBills } from "./letter-bills";
import { LetterReader } from "./letter-reader";
import { RecentChecks } from "./recent-checks";

type Props = {
  circle: CircleSnapshot;
  locale: Locale;
  copy: Dictionary["dashboard"]["letters"];
  speech: Dictionary["dashboard"]["speech"] | null;
  canReadPhotos: boolean;
  /** Whether this role may hold up letters and check demands; others only read the record of checks. */
  mayAct: boolean;
};

/** Holding up a letter and checking a demand for money, with the circle's record of checks beside them. */
export function LettersSection({ circle, locale, copy, speech, canReadPhotos, mayAct }: Props) {
  return (
    <section aria-labelledby="letters-heading" className="min-w-0 space-y-4">
      <header className="min-w-0 max-w-3xl">
        <h2 id="letters-heading" className="text-2xl font-semibold text-balance">{copy.title}</h2>
        <p className="mt-2 text-muted-foreground">{copy.lede}</p>
      </header>
      {mayAct ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <LetterReader locale={locale} currency={circle.circle.currency} copy={copy} speech={speech} canReadPhotos={canReadPhotos} />
          <DemandCheck locale={locale} copy={copy} speech={speech} />
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <LetterBills circle={circle} locale={locale} copy={copy} />
        <RecentChecks circle={circle} locale={locale} copy={copy} speech={speech} />
      </div>
    </section>
  );
}
