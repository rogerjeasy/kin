import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";
import type { DescribedVisits } from "@/server/caregiver-billing";

import { EvidenceText } from "./evidence-text";
import { ProvenanceBadge } from "./provenance-badge";

type Props = {
  outcome: DescribedVisits;
  /** The description as it was when it was read, so the marks always match what Kin was given. */
  sourceText: string;
  locale: Locale;
  copy: Dictionary["aiProvenance"];
};

/** A calendar day carries no currency; the formatter needs one to be built. */
const NO_MONEY = "USD";

/**
 * What Kin read from a description of visits: who read it, each day with how
 * long and the caregiver's own words it was traced to, and those words marked
 * in the description.
 */
export function VisitReadingResult({ outcome, sourceText, locale, copy }: Props) {
  const format = formatters(locale, NO_MONEY);
  const duration = (minutes: number) => (minutes % 60 === 0 ? fill(copy.visits.hours, { hours: String(minutes / 60) }) : fill(copy.visits.duration, { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) }));
  const highlights = outcome.visits.flatMap((visit) => visit.quotes.map((quote) => ({ id: visit.date, quote })));
  return (
    <div className="min-w-0 space-y-3">
      <ProvenanceBadge provenance={outcome.provenance} kind="read" copy={copy} />
      {outcome.visits.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.visits.none}</p>
      ) : (
        <ul className="min-w-0 space-y-2 text-sm">
          {outcome.visits.map((visit) => (
            <li key={visit.date} className="min-w-0 wrap-anywhere">
              <span className="font-semibold">{format.longCalendarDay(visit.date)}</span>
              {` · ${duration(visit.minutes)}`}
              {visit.quotes.map((quote) => (
                <span key={quote} className="block text-muted-foreground">
                  {fill(copy.visits.readFrom, { quote })}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      <EvidenceText text={sourceText} highlights={highlights} copy={copy.evidence} />
    </div>
  );
}
