import { AlertTriangleIcon, CheckCircle2Icon, CopyIcon, InfoIcon } from "lucide-react";

import { LetterEvidence } from "@/components/dashboard/ai/letter-evidence";
import { ProvenanceBadge } from "@/components/dashboard/ai/provenance-badge";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";
import type { LetterResult } from "@/server/letters";

type Props = {
  result: Extract<LetterResult, { ok: true }>;
  locale: Locale;
  currency: string;
  copy: Dictionary["dashboard"]["letters"];
  ai: Dictionary["aiProvenance"];
  /** What was typed or pasted when the letter was read; `null` for a photograph alone. */
  sourceText: string | null;
};

/** What Kin read from a letter, what became of it, and the words it says, so nothing is only heard. */
export function LetterResultCard({ result, locale, currency, copy, ai, sourceText }: Props) {
  const format = formatters(locale, currency);
  const { reading } = result;
  const sender = reading.sender ?? copy.result.unknownSender;
  const pill = reading.pressure
    ? { tone: "danger", icon: AlertTriangleIcon, label: copy.result.pressure }
    : result.outcome === "added"
      ? { tone: "positive", icon: CheckCircle2Icon, label: copy.result.added }
      : result.outcome === "duplicate"
        ? { tone: "waiting", icon: CopyIcon, label: copy.result.duplicate }
        : { tone: "neutral", icon: InfoIcon, label: copy.result.nothing };
  return (
    <div role="status" className="enter min-w-0 space-y-3 rounded-2xl border bg-secondary/50 p-4 shadow-xs sm:p-5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <StatusPill tone={pill.tone as "danger" | "positive" | "waiting" | "neutral"} icon={pill.icon}>{pill.label}</StatusPill>
        <ProvenanceBadge provenance={result.provenance} kind="read" copy={ai} />
      </div>
      <p className="wrap-anywhere text-lg font-semibold tracking-tight">{fill(copy.result.from, { kind: copy.result.kinds[reading.kind], sender })}</p>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {reading.amountCents === null ? null : <li>{fill(copy.result.amount, { amount: format.money(reading.amountCents) })}</li>}
        {reading.dueOn === null ? null : <li>{fill(copy.result.due, { day: format.day(reading.dueOn) })}</li>}
        {result.outcome === "added" ? <li>{copy.result.review}</li> : null}
        {reading.pressure ? <li className="text-danger">{copy.result.pressureNote}</li> : null}
        {reading.source === "model_photo" ? <li>{copy.result.photoNote}</li> : null}
        {reading.source === "rules" ? <li>{copy.result.rulesNote}</li> : null}
      </ul>
      <p className="wrap-anywhere text-sm">{result.words}</p>
      <LetterEvidence reading={reading} evidence={result.evidence} provenance={result.provenance} sourceText={sourceText} locale={locale} currency={currency} copy={ai.evidence} />
    </div>
  );
}
