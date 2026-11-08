import type { Provenance } from "@kin/agent/provenance";
import type { EvidenceField } from "@kin/documents";

import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";
import type { LetterResult, ShownReading } from "@/server/letters";

import { EvidenceText } from "./evidence-text";

type Props = {
  reading: ShownReading;
  evidence: Extract<LetterResult, { ok: true }>["evidence"];
  provenance: Provenance;
  /** What was typed or pasted, as it was when it was read. `null` when only a photograph was held up. */
  sourceText: string | null;
  locale: Locale;
  currency: string;
  copy: Dictionary["aiProvenance"]["evidence"];
};

const FIELDS: readonly EvidenceField[] = ["sender", "amount", "dueOn"];

/**
 * Beside each field Kin read, the words it was found in, and the typed words
 * with those places marked. A field with no words to point to says so, and so
 * does a reading made by fixed rules, which quote nothing.
 */
export function LetterEvidence({ reading, evidence, provenance, sourceText, locale, currency, copy }: Props) {
  const format = formatters(locale, currency);
  const values: Record<EvidenceField, string | null> = {
    sender: reading.sender,
    amount: reading.amountCents === null ? null : format.money(reading.amountCents),
    dueOn: reading.dueOn === null ? null : format.day(reading.dueOn),
  };
  const shown = FIELDS.filter((field) => values[field] !== null);
  const highlights = [...evidence.fields.map((each) => ({ id: each.field, quote: each.quote })), ...(evidence.claudeQuote?.checked ? [{ id: "claude", quote: evidence.claudeQuote.text }] : [])];
  return (
    <section aria-label={copy.title} className="min-w-0 space-y-3 border-t pt-3">
      <h4 className="text-sm font-semibold">{copy.title}</h4>
      {sourceText === null ? null : (
        <ul className="min-w-0 space-y-2 text-sm">
          {shown.map((field) => {
            const found = evidence.fields.find((each) => each.field === field);
            return (
              <li key={field} className="min-w-0 wrap-anywhere">
                <span className="font-semibold">{copy.fields[field]}: </span>
                {values[field]}
                <span className="block text-muted-foreground">{found === undefined ? copy.notFound : fill(copy.found, { quote: found.quote })}</span>
              </li>
            );
          })}
        </ul>
      )}
      {provenance.source === "rules" ? <p className="text-sm text-muted-foreground">{copy.rules}</p> : null}
      {evidence.claudeQuote === null ? null : (
        <p className="text-sm wrap-anywhere text-muted-foreground">{fill(evidence.claudeQuote.checked ? copy.claudeChecked : copy.claudeUnchecked, { quote: evidence.claudeQuote.text })}</p>
      )}
      {sourceText === null ? null : <EvidenceText text={sourceText} highlights={highlights} copy={copy} />}
    </section>
  );
}
