"use client";

import { EyeIcon } from "lucide-react";
import { useId, useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { useBillingRequest } from "@/components/dashboard/caregiver-billing/use-billing-request";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { DescribedVisits } from "@/server/caregiver-billing";

import { VisitReadingResult } from "./visit-reading-result";
import { WhyNotClaude } from "./why-not-claude";

type Props = {
  locale: Locale;
  copy: Dictionary["aiProvenance"];
  /** The caregiver billing words, for the errors and notes the real form shares. */
  billing: Dictionary["dashboard"]["caregiverBilling"];
};

/**
 * A demo circle's family tries the caregiver's way of billing without
 * switching seats: type what a caregiver might say and see what Kin reads,
 * with the evidence. It is a preview: the server makes no bill and keeps
 * nothing, and the caregiver's rate is not part of it.
 */
export function VisitPreview({ locale, copy, billing }: Props) {
  const id = useId();
  const [text, setText] = useState(copy.preview.sentence);
  const [shown, setShown] = useState<{ outcome: DescribedVisits; read: string } | null>(null);
  const { send, pending, error, why } = useBillingRequest(billing.errors, "/api/visit-preview");
  async function preview() {
    setShown(null);
    const read = text;
    const result = await send({ description: read });
    if (result.ok && "described" in result) setShown({ outcome: result, read });
  }
  return (
    <Panel title={copy.preview.title} description={copy.preview.text} aside={<StatusPill tone="waiting" icon={EyeIcon}>{copy.preview.tag}</StatusPill>}>
      <div className="min-w-0 space-y-3">
        <label htmlFor={id} className="font-medium">{copy.preview.label}</label>
        <textarea id={id} rows={3} maxLength={1000} value={text} disabled={pending} onChange={(event) => setText(event.target.value)} className={`${inputClass} min-h-24 py-2`} />
        <Button type="button" variant="outline" disabled={pending || text.trim() === ""} className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start" onClick={preview}>
          <EyeIcon aria-hidden="true" />
          {pending ? copy.preview.reading : copy.preview.submit}
        </Button>
        {error ? <p role="alert" className="text-sm text-danger">{billing.errors[error]}</p> : null}
        {why === null ? null : <WhyNotClaude why={why} copy={copy} />}
        {shown ? (
          <div role="status" className="min-w-0 space-y-3 rounded-2xl border bg-muted/60 p-4">
            <h3 className="font-semibold">{copy.preview.resultTitle}</h3>
            <VisitReadingResult outcome={shown.outcome} sourceText={shown.read} locale={locale} copy={copy} />
            {shown.outcome.unclear.length > 0 ? <p className="text-sm wrap-anywhere text-muted-foreground">{fill(billing.unclearNote, { items: shown.outcome.unclear.join("; ") })}</p> : null}
            {shown.outcome.dropped > 0 ? <p className="text-sm text-muted-foreground">{fill(billing.droppedNote, { count: String(shown.outcome.dropped) })}</p> : null}
            <p className="text-sm font-medium">{copy.preview.nothingSaved}</p>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
