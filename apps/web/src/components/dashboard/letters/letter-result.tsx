import { AlertTriangleIcon, CheckCircle2Icon, CopyIcon, InfoIcon } from "lucide-react";

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
};

/** What Kin read from a letter, what became of it, and the words it says, so nothing is only heard. */
export function LetterResultCard({ result, locale, currency, copy }: Props) {
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
    <div role="status" className="min-w-0 space-y-3 rounded-xl border bg-secondary/40 p-4">
      <StatusPill tone={pill.tone as "danger" | "positive" | "waiting" | "neutral"} icon={pill.icon}>{pill.label}</StatusPill>
      <p className="wrap-anywhere font-medium">{fill(copy.result.from, { kind: copy.result.kinds[reading.kind], sender })}</p>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {reading.amountCents === null ? null : <li>{fill(copy.result.amount, { amount: format.money(reading.amountCents) })}</li>}
        {reading.dueOn === null ? null : <li>{fill(copy.result.due, { day: format.day(reading.dueOn) })}</li>}
        {result.outcome === "added" ? <li>{copy.result.review}</li> : null}
        {reading.pressure ? <li className="text-danger">{copy.result.pressureNote}</li> : null}
        {reading.source === "model_photo" ? <li>{copy.result.photoNote}</li> : null}
        {reading.source === "rules" ? <li>{copy.result.rulesNote}</li> : null}
      </ul>
      <p className="wrap-anywhere text-sm">{result.words}</p>
    </div>
  );
}
