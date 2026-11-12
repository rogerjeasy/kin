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
  ai: Dictionary["aiProvenance"];
  speech: Dictionary["dashboard"]["speech"] | null;
  canReadPhotos: boolean;
  /** Whether the sample letter photo is offered: a demo circle. */
  offerSample: boolean;
  /** Whether this role may hold up letters and check demands; others only read the record of checks. */
  mayAct: boolean;
  /** Whether this role may confirm a bill read from a letter and say how it is paid. */
  mayReview: boolean;
  approvalsHref: string;
};

/** Holding up a letter and checking a demand for money, with the circle's record of checks beside them. */
export function LettersSection({ circle, locale, copy, ai, speech, canReadPhotos, offerSample, mayAct, mayReview, approvalsHref }: Props) {
  return (
    <section aria-labelledby="letters-heading" className="min-w-0 space-y-4">
      <header className="min-w-0 max-w-3xl">
        <h2 id="letters-heading" className="text-2xl font-semibold text-balance">{copy.title}</h2>
        <p className="mt-2 text-muted-foreground">{copy.lede}</p>
      </header>
      {mayAct ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <LetterReader locale={locale} currency={circle.circle.currency} copy={copy} ai={ai} speech={speech} canReadPhotos={canReadPhotos} offerSample={offerSample} />
          <DemandCheck locale={locale} copy={copy} ai={ai} speech={speech} />
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <LetterBills circle={circle} locale={locale} copy={copy} ai={ai} mayReview={mayReview} approvalsHref={approvalsHref} />
        <RecentChecks circle={circle} locale={locale} copy={copy} speech={speech} />
      </div>
    </section>
  );
}
