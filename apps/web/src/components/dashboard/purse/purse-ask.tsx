"use client";

import { MessageCircleHeartIcon } from "lucide-react";
import { useId, useState } from "react";
import { MAX_PURSE_WORDS_CHARS } from "@kin/domain";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { MicButton } from "@/components/dashboard/speech/mic-button";
import { transcribe } from "@/components/dashboard/speech/speech-client";
import { SpeechStatus } from "@/components/dashboard/speech/speech-status";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";
import type { PursePaymentView } from "@/server/purse";

import { AnswerOutcome } from "./answer-outcome";
import { PurseError } from "./purse-error";
import { ReadBackCard } from "./read-back-card";
import { usePurseRequest } from "./use-purse-request";

type Props = {
  locale: Locale;
  copy: Dictionary["dashboard"]["purse"];
  speech: Dictionary["dashboard"]["speech"];
  /** The circle's currency and time zone: amounts are written here, since functions cannot cross from the server. */
  currency: string;
  timezone: string;
  capCents: number;
  /** False while the Purse is paused or outgoing money is held: she may not ask now. */
  canAsk: boolean;
};

const EXAMPLES = ["gift", "church", "scam"] as const;

/**
 * Voice first: she says who to pay, or types it. The server reads her words,
 * decides by plain code and reads the payment back; this screen only carries
 * the words, shows the read-back and her answer, and offers to start again.
 */
export function PurseAsk({ locale, copy, speech, currency, timezone, capCents, canAsk }: Props) {
  const id = useId();
  const format = formatters(locale, currency, timezone);
  const { send, pending, error, clear } = usePurseRequest();
  const [words, setWords] = useState("");
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PursePaymentView | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const { ask } = copy;

  async function readBack(said: string) {
    setPayment(null);
    setOutcome(null);
    const reply = await send({ operation: "ask", words: said, locale });
    if (reply.ok && reply.payment) setPayment(reply.payment);
  }

  async function spoken(pcm: Uint8Array) {
    setSpeechError(null);
    clear();
    setListening(true);
    const heard = await transcribe(pcm, locale);
    setListening(false);
    if (!heard.ok) return setSpeechError(heard.reason);
    setWords(heard.transcript);
    if (heard.transcript.trim() !== "") await readBack(heard.transcript.slice(0, MAX_PURSE_WORDS_CHARS));
  }

  function again() {
    setPayment(null);
    setOutcome(null);
    setWords("");
    clear();
  }

  if (payment !== null && outcome !== null) {
    return (
      <Panel title={ask.title}>
        <AnswerOutcome outcome={outcome} payment={payment} copy={copy} money={format.money} onAgain={again} />
      </Panel>
    );
  }

  return (
    <Panel title={ask.title} description={ask.text}>
      {payment === null ? (
        <form
          className="min-w-0 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void readBack(words);
          }}
        >
          <MicButton label={ask.speak} copy={speech} disabled={!canAsk || pending || listening} onRecorded={(pcm) => void spoken(pcm)} className="min-h-16 border-2 border-primary/40 px-8 text-xl [&_svg]:size-6" />
          <SpeechStatus copy={speech} working={listening} error={speechError} note={null} />
          <fieldset className="min-w-0 space-y-2">
            <legend className="font-medium">{ask.examplesLabel}</legend>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((key) => (
                <Button key={key} type="button" variant="outline" disabled={!canAsk || pending} onClick={() => setWords(ask.examples[key].text)} className="h-auto min-h-11 max-w-full whitespace-normal text-start">
                  {ask.examples[key].label}
                </Button>
              ))}
            </div>
          </fieldset>
          <div className="min-w-0 space-y-1">
            <label htmlFor={`${id}-words`} className="text-lg font-medium">
              {ask.typeLabel}
            </label>
            <p id={`${id}-hint`} className="text-sm text-muted-foreground">
              {ask.hint}
            </p>
            <textarea
              id={`${id}-words`}
              aria-describedby={`${id}-hint`}
              dir="auto"
              rows={3}
              maxLength={MAX_PURSE_WORDS_CHARS}
              value={words}
              disabled={!canAsk || pending}
              onChange={(event) => setWords(event.target.value)}
              className={`${inputClass} min-h-24 py-3 text-xl`}
            />
          </div>
          <Button type="submit" disabled={!canAsk || pending || words.trim() === ""} className="h-auto min-h-16 w-full max-w-full whitespace-normal px-6 text-xl sm:w-auto">
            <MessageCircleHeartIcon aria-hidden="true" className="size-6" />
            {pending ? ask.submitting : ask.submit}
          </Button>
          <PurseError copy={copy.errors} error={error} money={format.money} />
        </form>
      ) : (
        <div className="min-w-0 space-y-4">
          <p className="text-sm text-muted-foreground wrap-anywhere">{fill(ask.heard, { words })}</p>
          <ReadBackCard payment={payment} locale={locale} copy={copy} speech={speech} money={format.money} capCents={capCents} onAnswered={setOutcome} />
          <Button type="button" variant="ghost" onClick={again} className="h-auto min-h-11 max-w-full whitespace-normal">
            {ask.startOver}
          </Button>
        </div>
      )}
    </Panel>
  );
}
