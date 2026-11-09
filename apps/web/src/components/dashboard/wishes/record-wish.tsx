"use client";

import type { DraftedWish } from "@kin/agent";
import { MicIcon, SquareIcon, Volume2Icon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { useRecorder } from "@/components/dashboard/speech/use-recorder";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";

import { DraftReadBack } from "./draft-read-back";
import { parseReply, useWishRequest } from "./use-wish-request";
import type { WishNameBook } from "@/components/dashboard/words/wish-words";

type Props = {
  readonly copy: Dictionary["dashboard"]["wishes"];
  readonly locale: Locale;
  readonly book: WishNameBook;
  readonly currency: string;
  readonly timezone: string;
  /** The wish she is saying differently, if she chose to. */
  readonly changing: { readonly wishKey: string; readonly quote: string; readonly cancelHref: string } | null;
};

/**
 * The parent's own way to say a wish: voice first, typing as well. Kin keeps
 * her recording, writes her words down, reads them back as rules, and keeps
 * only the ones she confirms. Nothing she has not confirmed is stored as a wish.
 */
export function RecordWish({ copy, locale, book, currency, timezone, changing }: Props) {
  const fieldId = useId();
  const recorder = useRecorder();
  const { send, pending, error } = useWishRequest();
  const [said, setSaid] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [hearing, setHearing] = useState<"idle" | "transcribing" | "no_speech" | "failed">("idle");
  const [drafts, setDrafts] = useState<readonly DraftedWish[] | null>(null);
  const record = copy.record;

  async function speak() {
    const pcm = await recorder.record();
    if (pcm === null || pcm.byteLength === 0) return;
    setHearing("transcribing");
    try {
      const response = await fetch(`/api/wishes/recording?${new URLSearchParams({ locale })}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(pcm) });
      const reply = parseReply(await response.json()) as ReturnType<typeof parseReply> & { recordingId?: string; transcript?: string | null };
      if (!reply.ok) return setHearing("failed");
      setRecordingId(reply.recordingId ?? null);
      if (typeof reply.transcript === "string" && reply.transcript !== "") {
        setSaid(reply.transcript);
        setHearing("idle");
      } else setHearing("no_speech");
    } catch {
      setHearing("failed");
    }
  }

  async function readBack() {
    setDrafts(null);
    const reply = await send({ operation: "draft", said, locale }, { refresh: false });
    if (reply.ok) setDrafts(reply.wishes ?? []);
  }

  return (
    <section id="say" aria-labelledby={`${fieldId}-title`} className="flex min-w-0 scroll-mt-24 flex-col gap-5 rounded-2xl border-2 border-primary/30 bg-card p-5 shadow-xs sm:p-7">
      <div className="min-w-0">
        <h2 id={`${fieldId}-title`} className="text-2xl font-semibold text-balance sm:text-3xl">
          {record.title}
        </h2>
        <p className="mt-2 text-lg text-pretty text-muted-foreground">{record.text}</p>
      </div>
      {changing ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl bg-secondary/50 p-4">
          <p className="min-w-0 flex-1 basis-60 text-lg text-pretty break-words">{fill(record.changing, { quote: changing.quote })}</p>
          <Button asChild variant="outline" className="h-auto min-h-12">
            <Link href={changing.cancelHref}>{record.cancelChange}</Link>
          </Button>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-3">
        {recorder.state === "recording" ? (
          <Button type="button" onClick={recorder.stop} className="h-auto min-h-20 w-full max-w-full px-8 text-xl whitespace-normal sm:w-auto">
            <SquareIcon aria-hidden="true" className="size-7" />
            {record.stop}
          </Button>
        ) : (
          <Button type="button" onClick={speak} disabled={hearing === "transcribing" || pending} className="h-auto min-h-20 w-full max-w-full px-8 text-xl whitespace-normal sm:w-auto">
            <MicIcon aria-hidden="true" className="size-7" />
            {record.speak}
          </Button>
        )}
        <div aria-live="polite" className="min-w-0 text-lg text-pretty">
          {recorder.state === "recording" ? <p>{record.listening}</p> : null}
          {hearing === "transcribing" ? <p>{record.transcribing}</p> : null}
          {hearing === "no_speech" ? <p>{record.noSpeech}</p> : null}
          {recordingId !== null && hearing === "idle" ? <p className="text-base text-muted-foreground">{record.recordingKept}</p> : null}
        </div>
        {recorder.state === "denied" ? (
          <p role="alert" className="text-lg text-danger">
            {record.micDenied}
          </p>
        ) : null}
        {hearing === "failed" ? (
          <p role="alert" className="text-lg text-danger">
            {copy.reasons.recording}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor={fieldId} className="text-lg font-semibold">
          {record.label}
          <span className="block text-base font-normal text-muted-foreground">{record.or}</span>
        </label>
        <textarea
          id={fieldId}
          value={said}
          onChange={(event) => setSaid(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={record.placeholder}
          className="min-h-28 w-full min-w-0 rounded-xl border border-input bg-background px-4 py-3 text-xl leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={readBack} disabled={pending || said.trim() === ""} className="h-auto min-h-14 w-full max-w-full px-6 text-lg whitespace-normal sm:w-auto">
          <Volume2Icon aria-hidden="true" />
          {record.readBack}
        </Button>
        {pending && drafts === null ? (
          <p role="status" className="text-lg text-muted-foreground">
            {record.reading}
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-lg text-danger">
          {copy.reasons[error]}
        </p>
      ) : null}
      {drafts !== null ? <DraftReadBack copy={copy} drafts={drafts} book={book} locale={locale} currency={currency} timezone={timezone} recordingId={recordingId} wishKey={changing?.wishKey ?? null} /> : null}
    </section>
  );
}
