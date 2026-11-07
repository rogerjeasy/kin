"use client";

import { PhoneCallIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { postLetterJson, type LetterError } from "@/components/dashboard/letters/letter-client";
import { VerdictPill } from "@/components/dashboard/letters/verdict-pill";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { OfficeCallResult } from "@/server/office-line";

import { CallTranscript } from "./call-transcript";

type Props = { locale: Locale; copy: Dictionary["dashboard"]["officeLine"] };

type Done = Extract<OfficeCallResult, { ok: true }>;

const SCENARIOS = ["scam", "paid", "real"] as const;

/**
 * The "try the office line" screen: the caller's words are written down and
 * played through the same receptionist that answers the phone. The server
 * decides everything; this form only carries words.
 */
export function CallSimulator({ locale, copy }: Props) {
  const id = useId();
  const router = useRouter();
  const [lines, setLines] = useState(copy.scenarios.scam.lines.join("\n"));
  const [number, setNumber] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Done | null>(null);

  async function placeCall() {
    setPending(true);
    setError(null);
    setResult(null);
    const callerLines = lines.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    const reply = await postLetterJson<Done>("/api/office-line/call", { locale, lines: callerLines, ...(number.trim() === "" ? {} : { number: number.trim() }) });
    setPending(false);
    if (reply.ok) {
      setResult(reply);
      // The list of recent calls beside this form is read on the server: fetch it again.
      router.refresh();
    } else setError((reply as LetterError).reason);
  }

  return (
    <Panel title={copy.heading} description={copy.how}>
      <form
        className="min-w-0 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void placeCall();
        }}
      >
        <fieldset className="min-w-0 space-y-2">
          <legend className="font-medium">{copy.scenariosLabel}</legend>
          <div className="flex flex-wrap gap-2">
            {SCENARIOS.map((key) => (
              <Button key={key} type="button" variant="outline" disabled={pending} onClick={() => setLines(copy.scenarios[key].lines.join("\n"))} className="h-auto min-h-11 max-w-full whitespace-normal text-start">
                {copy.scenarios[key].label}
              </Button>
            ))}
          </div>
        </fieldset>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-lines`} className="font-medium">{copy.callerLinesLabel}</label>
          <p id={`${id}-lines-hint`} className="text-sm text-muted-foreground">{copy.callerLinesHint}</p>
          <textarea id={`${id}-lines`} aria-describedby={`${id}-lines-hint`} rows={6} required value={lines} disabled={pending} onChange={(event) => setLines(event.target.value)} className={`${inputClass} min-h-36 py-2`} />
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-number`} className="font-medium">{copy.numberLabel}</label>
          <p id={`${id}-number-hint`} className="text-sm text-muted-foreground">{copy.numberHint}</p>
          <input id={`${id}-number`} aria-describedby={`${id}-number-hint`} inputMode="tel" autoComplete="off" maxLength={32} value={number} disabled={pending} onChange={(event) => setNumber(event.target.value)} className={inputClass} />
        </div>
        <Button type="submit" disabled={pending || lines.trim() === ""} className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start">
          <PhoneCallIcon aria-hidden="true" />
          {pending ? copy.calling : copy.submit}
        </Button>
        {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error as keyof typeof copy.errors] ?? copy.errors.unavailable}</p> : null}
        {result ? (
          <div role="status" className="min-w-0 space-y-4 rounded-xl border bg-secondary/40 p-4">
            <CallTranscript turns={result.transcript} labels={{ kin: copy.kin, caller: copy.caller, title: copy.transcriptTitle }} />
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold">{copy.verdictTitle}</h3>
              <VerdictPill verdict={result.verdict} payeeId={result.payeeId} labels={copy.verdicts} />
            </div>
            {result.pressure.length > 0 ? (
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold">{copy.pressureTitle}</h3>
                <p className="text-sm">{result.pressure.map((signal) => copy.signals[signal]).join(", ")}</p>
              </div>
            ) : null}
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold">{copy.alertTitle}</h3>
              <p className="text-sm wrap-anywhere">{result.alert}</p>
              <p className="text-sm text-muted-foreground">{fill(copy.told, { count: String(result.told) })}</p>
            </div>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}
