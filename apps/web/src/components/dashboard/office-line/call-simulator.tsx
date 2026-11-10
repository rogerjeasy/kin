"use client";

import { BadgeCheckIcon, PhoneCallIcon, ReceiptIcon, ShieldAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { postLetterJson, type LetterError } from "@/components/dashboard/letters/letter-client";
import { KinThinking } from "@/components/dashboard/ai/kin-thinking";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import type { OfficeCallResult } from "@/server/office-line";

import { CallOutcome } from "./call-outcome";

type Props = { locale: Locale; copy: Dictionary["dashboard"]["officeLine"] };

type Done = Extract<OfficeCallResult, { ok: true }>;

const SCENARIOS = ["scam", "paid", "real"] as const;
const SCENARIO_ICON = { scam: ShieldAlertIcon, paid: ReceiptIcon, real: BadgeCheckIcon } as const;

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
          <div className="grid min-w-0 gap-2 sm:grid-cols-3">
            {SCENARIOS.map((key) => {
              const Icon = SCENARIO_ICON[key];
              const chosen = lines === copy.scenarios[key].lines.join("\n");
              return (
                <Button key={key} type="button" variant="outline" disabled={pending} onClick={() => setLines(copy.scenarios[key].lines.join("\n"))} className={cn("lift h-auto min-h-14 max-w-full justify-start rounded-2xl px-4 py-3 whitespace-normal text-start", chosen && "border-gold/70 bg-highlight/10 shadow-[0_0_0_3px_rgb(var(--glow-gold)/0.15)]")}>
                  <span aria-hidden="true" className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full ring-1", chosen ? "bg-gold/25 text-highlight ring-gold/50" : "bg-secondary text-muted-foreground ring-border")}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">{copy.scenarios[key].label}</span>
                </Button>
              );
            })}
          </div>
        </fieldset>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-lines`} className="font-medium">{copy.callerLinesLabel}</label>
          <p id={`${id}-lines-hint`} className="text-sm text-muted-foreground">{copy.callerLinesHint}</p>
          <textarea id={`${id}-lines`} aria-describedby={`${id}-lines-hint`} rows={6} required value={lines} disabled={pending} onChange={(event) => setLines(event.target.value)} className={`${inputClass} min-h-40 py-3 font-mono text-[0.95rem] leading-7`} />
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-number`} className="font-medium">{copy.numberLabel}</label>
          <p id={`${id}-number-hint`} className="text-sm text-muted-foreground">{copy.numberHint}</p>
          <input id={`${id}-number`} aria-describedby={`${id}-number-hint`} inputMode="tel" autoComplete="off" maxLength={32} value={number} disabled={pending} onChange={(event) => setNumber(event.target.value)} className={inputClass} />
        </div>
        <Button type="submit" disabled={pending || lines.trim() === ""} className="h-auto min-h-12 max-w-full shrink whitespace-normal text-start">
          <PhoneCallIcon aria-hidden="true" className={pending ? "motion-safe:animate-bounce" : undefined} />
          {pending ? copy.calling : copy.submit}
        </Button>
        {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error as keyof typeof copy.errors] ?? copy.errors.unavailable}</p> : null}
        {pending ? <KinThinking label={copy.calling} /> : null}
        {result ? <CallOutcome result={result} copy={copy} /> : null}
      </form>
    </Panel>
  );
}
