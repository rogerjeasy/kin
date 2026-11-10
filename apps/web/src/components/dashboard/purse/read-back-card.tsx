"use client";

import { CheckIcon, HandIcon, ShieldAlertIcon, Volume2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { PURSE_CONFIRM_MINUTES } from "@kin/domain";

import { MicButton } from "@/components/dashboard/speech/mic-button";
import { speak, transcribe } from "@/components/dashboard/speech/speech-client";
import { SpeechStatus } from "@/components/dashboard/speech/speech-status";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { numberLocaleOf, type Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { PursePaymentView } from "@/server/purse";

import { HoldReasons } from "./hold-reasons";
import { PurseError } from "./purse-error";
import { usePurseRequest } from "./use-purse-request";

type Props = {
  payment: PursePaymentView;
  locale: Locale;
  copy: Dictionary["dashboard"]["purse"];
  speech: Dictionary["dashboard"]["speech"];
  /** Formatted on the client: functions cannot cross from the server. */
  money: (cents: number) => string;
  capCents: number;
  onAnswered: (outcome: string) => void;
};

const BIG = "h-auto min-h-16 w-full max-w-full whitespace-normal px-6 py-3 text-xl sm:w-auto";

/**
 * What Kin read back, and her answer. A payment Kin would not hold takes a yes
 * or a no, by tap or by voice. One Kin would hold first asks her, gently,
 * whether someone is telling her what to do: her answer is hers, and either
 * way the family is told. Her yes is the payment's approval; the database
 * records it and decides again.
 */
export function ReadBackCard({ payment, locale, copy, speech, money, capCents, onAnswered }: Props) {
  const { send, pending, error } = usePurseRequest();
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [unclear, setUnclear] = useState(false);
  const holds = payment.holdReasons.length > 0;
  const { confirm } = copy;

  async function answer(choice: "yes" | "no" | "pressured", method: "app" | "voice", evidence: string) {
    const reply = await send({ operation: "answer", paymentId: payment.id, answer: choice, method, evidence });
    if (reply.ok && typeof reply.outcome === "string") onAnswered(reply.outcome);
  }

  async function listen() {
    setSpeechError(null);
    setSpeaking(true);
    const result = await speak({ kind: "purse", paymentId: payment.id, locale });
    setSpeaking(false);
    if (!result.ok) setSpeechError(result.reason);
  }

  async function byVoice(pcm: Uint8Array) {
    setSpeechError(null);
    setUnclear(false);
    setSpeaking(true);
    const heard = await transcribe(pcm, locale);
    setSpeaking(false);
    if (!heard.ok) return setSpeechError(heard.reason);
    if (heard.answer === "unclear") return setUnclear(true);
    await answer(heard.answer, "voice", heard.transcript.slice(0, 400) || heard.answer);
  }

  return (
    <section aria-labelledby={`read-back-${payment.id}`} className={`min-w-0 space-y-5 rounded-2xl border-2 p-5 sm:p-6 ${holds ? "border-highlight/60 bg-highlight/5" : "border-primary/40 bg-card"}`}>
      <h3 id={`read-back-${payment.id}`} className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {confirm.title}
      </h3>
      <p className="text-2xl leading-snug font-semibold text-balance wrap-anywhere sm:text-3xl" aria-live="polite">
        {payment.readBack}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={speaking || pending} onClick={() => void listen()} className="h-auto min-h-12 max-w-full whitespace-normal">
          <Volume2Icon aria-hidden="true" />
          {confirm.listen}
        </Button>
        {payment.simulated ? <span className="text-sm text-muted-foreground">{copy.simulated}</span> : null}
      </div>

      {holds ? (
        <div className="min-w-0 space-y-4">
          <HoldReasons reasons={payment.holdReasons} payee={payment.payeeName} cap={money(capCents)} copy={copy} />
          <div className="rounded-xl bg-card p-4 shadow-xs">
            <p className="flex items-start gap-2 text-xl font-semibold text-balance">
              <ShieldAlertIcon aria-hidden="true" className="mt-1 size-6 shrink-0 text-highlight" />
              {confirm.question}
            </p>
            <p className="mt-2 text-base text-muted-foreground">{confirm.questionText}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button type="button" disabled={pending} onClick={() => void answer("pressured", "app", confirm.pressured)} className={BIG}>
              <HandIcon aria-hidden="true" className="size-6" />
              {confirm.pressured}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => void answer("yes", "app", confirm.ownIdea)} className={BIG}>
              {confirm.ownIdea}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => void answer("no", "app", confirm.dontSend)} className={BIG}>
              <XIcon aria-hidden="true" className="size-6" />
              {confirm.dontSend}
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button type="button" disabled={pending} onClick={() => void answer("yes", "app", confirm.yes)} className={BIG}>
              <CheckIcon aria-hidden="true" className="size-6" />
              {confirm.yes}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => void answer("no", "app", confirm.no)} className={BIG}>
              <XIcon aria-hidden="true" className="size-6" />
              {confirm.no}
            </Button>
          </div>
          <MicButton label={confirm.answerByVoice} copy={speech} disabled={pending || speaking} onRecorded={(pcm) => void byVoice(pcm)} />
          {unclear ? <p role="alert" className="text-base text-danger">{confirm.unclear}</p> : null}
        </div>
      )}
      <p className="text-sm text-muted-foreground">{fill(confirm.expires, { minutes: new Intl.NumberFormat(numberLocaleOf(locale)).format(PURSE_CONFIRM_MINUTES) })}</p>
      <SpeechStatus copy={speech} working={speaking} error={speechError} note={null} />
      <PurseError copy={copy.errors} error={error} money={money} />
    </section>
  );
}
