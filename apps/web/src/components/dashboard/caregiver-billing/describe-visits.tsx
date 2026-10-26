"use client";

import { SparklesIcon } from "lucide-react";
import { useId, useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { DescribedVisits } from "@/server/caregiver-billing";

import { MicButton } from "@/components/dashboard/speech/mic-button";
import { transcribe } from "@/components/dashboard/speech/speech-client";
import { SpeechStatus } from "@/components/dashboard/speech/speech-status";
import type { Locale } from "@/i18n/locales";

import { useBillingRequest } from "./use-billing-request";

type Props = {
  locale: Locale;
  copy: Dictionary["dashboard"]["caregiverBilling"];
  /** Kin's listening, when this deployment has it: the caregiver may speak instead of typing. */
  speech: Dictionary["dashboard"]["speech"] | null;
  disabled: boolean;
  onDescribed: (visits: DescribedVisits["visits"]) => void;
};

/**
 * The caregiver writes their visits as they would say them, and Claude reads
 * them into days to fill the form. Nothing is sent for payment: the
 * caregiver checks the days, then reviews the bill as always.
 */
export function DescribeVisits({ locale, copy, speech, disabled, onDescribed }: Props) {
  const id = useId();
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<DescribedVisits | null>(null);
  const { send, pending, error } = useBillingRequest(copy.errors);
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  // What was said is written into the box, where the caregiver can read and correct it before Kin reads it.
  async function heard(pcm: Uint8Array) {
    setSpeechError(null);
    setListening(true);
    const result = await transcribe(pcm, locale);
    setListening(false);
    if (!result.ok) return setSpeechError(result.reason);
    setText((before) => [before.trim(), result.transcript].filter((part) => part !== "").join(" ").slice(0, 1000));
  }
  async function read() {
    setOutcome(null);
    const result = await send({ operation: "describe", description: text });
    if (result.ok && "described" in result) {
      setOutcome(result);
      if (result.visits.length > 0) onDescribed(result.visits);
    }
  }
  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-dashed p-4">
      <label htmlFor={id} className="font-medium">{copy.describeLabel}</label>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">{copy.describeHint}</p>
      <textarea id={id} aria-describedby={`${id}-hint`} rows={3} maxLength={1000} value={text} disabled={disabled || pending} onChange={(event) => setText(event.target.value)} className={`${inputClass} min-h-24 py-2`} />
      {speech ? (
        <>
          <MicButton label={copy.speech.speakVisits} copy={speech} disabled={disabled || pending || listening} onRecorded={heard} />
          <SpeechStatus copy={speech} working={listening} error={speechError} note={null} />
        </>
      ) : null}
      <Button type="button" variant="outline" disabled={disabled || pending || text.trim() === ""} className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start" onClick={read}>
        <SparklesIcon aria-hidden="true" />
        {pending ? copy.describing : copy.describe}
      </Button>
      {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
      {outcome ? (
        <div role="status" className="space-y-1 text-sm">
          {outcome.visits.length > 0 ? <p className="text-positive">{copy.described}</p> : null}
          {outcome.unclear.length > 0 ? <p className="wrap-anywhere text-muted-foreground">{fill(copy.unclearNote, { items: outcome.unclear.join("; ") })}</p> : null}
          {outcome.dropped > 0 ? <p className="text-muted-foreground">{fill(copy.droppedNote, { count: String(outcome.dropped) })}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
