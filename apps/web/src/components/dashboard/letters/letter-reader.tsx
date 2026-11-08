"use client";

import { CameraIcon, FileTextIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { SampleLetter } from "@/components/dashboard/ai/sample-letter";
import { inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import type { LetterResult } from "@/server/letters";

import { HearButton } from "./hear-button";
import { photoForKin, postLetterJson, type LetterError } from "./letter-client";
import { LetterResultCard } from "./letter-result";

type Props = {
  locale: Locale;
  currency: string;
  copy: Dictionary["dashboard"]["letters"];
  ai: Dictionary["aiProvenance"];
  /** Kin's voice, when this deployment has it. */
  speech: Dictionary["dashboard"]["speech"] | null;
  /** Whether Claude can read a photograph here. Without it only typed words are read. */
  canReadPhotos: boolean;
  /** Whether a sample letter photo is offered: a demo circle with Claude behind it, so nothing false lands in a real family's list. */
  offerSample: boolean;
};

/**
 * Hold up a letter: a photograph, its words, or both. Kin reads it, the
 * server lists a bill for someone to review, and what Kin says is shown and
 * can be played. Nothing here pays anything.
 */
export function LetterReader({ locale, currency, copy, ai, speech, canReadPhotos, offerSample }: Props) {
  const id = useId();
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ reading: Extract<LetterResult, { ok: true }>; typed: string | null } | null>(null);

  /** Reads what was chosen, or `chosen` when a sample is: through the one route every photograph takes. */
  async function read(chosen?: File) {
    setPending(true);
    setError(null);
    setResult(null);
    const picture = chosen ?? photo;
    const typed = chosen === undefined && text.trim() !== "" ? text.trim() : null;
    const image = picture === null ? null : await photoForKin(picture);
    if (picture !== null && image === null) {
      setPending(false);
      return setError("unreadable");
    }
    const reply = await postLetterJson<Extract<LetterResult, { ok: true }>>("/api/letters/read", { text: typed, image, locale });
    setPending(false);
    if (reply.ok) {
      setResult({ reading: reply, typed });
      // The bills list beside this form is read on the server: fetch it again.
      router.refresh();
    } else setError((reply as LetterError).reason);
  }

  function again() {
    setResult(null);
    setPhoto(null);
    setText("");
    if (file.current) file.current.value = "";
  }

  const empty = photo === null && text.trim() === "";
  return (
    <Panel title={copy.read.title} description={copy.read.text}>
      <div className="min-w-0 space-y-4">
        {canReadPhotos && offerSample ? <SampleLetter copy={ai.sample} disabled={pending} onPick={(sample) => void read(sample)} /> : null}
        {canReadPhotos ? (
          <div className="min-w-0 space-y-2">
            <input ref={file} id={`${id}-photo`} type="file" accept="image/*" capture="environment" className="sr-only" disabled={pending} onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
            <Button type="button" variant="outline" disabled={pending} className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start" onClick={() => file.current?.click()}>
              <CameraIcon aria-hidden="true" />
              {copy.read.photo}
            </Button>
            {photo ? <p className="wrap-anywhere text-sm text-muted-foreground">{copy.read.photoReady.replace("{name}", photo.name)}</p> : null}
          </div>
        ) : null}
        <div className="min-w-0 space-y-2">
          <label htmlFor={`${id}-words`} className="font-medium">{copy.read.wordsLabel}</label>
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">{copy.read.wordsHint}</p>
          <textarea id={`${id}-words`} aria-describedby={`${id}-hint`} rows={5} maxLength={6000} value={text} disabled={pending} onChange={(event) => setText(event.target.value)} className={`${inputClass} min-h-28 py-2`} />
        </div>
        <Button type="button" disabled={pending || empty} className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start" onClick={() => void read()}>
          <FileTextIcon aria-hidden="true" />
          {pending ? copy.read.reading : copy.read.submit}
        </Button>
        {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error as keyof typeof copy.errors] ?? copy.errors.unavailable}</p> : null}
        {result ? (
          <div className="min-w-0 space-y-3">
            <LetterResultCard result={result.reading} locale={locale} currency={currency} copy={copy} ai={ai} sourceText={result.typed} />
            <div className="flex min-w-0 flex-wrap items-start gap-3">
              {speech ? <HearButton label={copy.read.hear} speaking={copy.read.hearing} request={{ kind: "letter", documentId: result.reading.documentId }} locale={locale} speech={speech} /> : null}
              <Button type="button" variant="ghost" className="h-auto min-h-11" onClick={again}>{copy.read.again}</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
