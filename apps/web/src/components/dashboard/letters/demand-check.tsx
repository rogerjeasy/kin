"use client";

import { ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { ProvenanceBadge } from "@/components/dashboard/ai/provenance-badge";
import { inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { DemandResult } from "@/server/letters";

import { HearButton } from "./hear-button";
import { postLetterJson, type LetterError } from "./letter-client";
import { VerdictPill } from "./verdict-pill";

type Props = {
  locale: Locale;
  copy: Dictionary["dashboard"]["letters"];
  ai: Dictionary["aiProvenance"];
  speech: Dictionary["dashboard"]["speech"] | null;
};

/**
 * Someone demands money: who, how much, and what they said. Plain code on
 * the server compares it with what was billed and paid; Kin tells the whole
 * circle. What they said is shown back as information, never acted on.
 */
export function DemandCheck({ locale, copy, ai, speech }: Props) {
  const id = useId();
  const router = useRouter();
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [claim, setClaim] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<DemandResult, { ok: true }> | null>(null);

  async function check() {
    setPending(true);
    setError(null);
    setResult(null);
    const reply = await postLetterJson<Extract<DemandResult, { ok: true }>>("/api/letters/check", { payee, amount, claim, locale });
    setPending(false);
    if (reply.ok) {
      setResult(reply);
      // The record of checks beside this form is read on the server: fetch it again.
      router.refresh();
    } else setError((reply as LetterError).reason);
  }

  const { check: words } = copy;
  return (
    <Panel title={words.title} description={words.text}>
      <form
        className="min-w-0 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void check();
        }}
      >
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-payee`} className="font-medium">{words.payeeLabel}</label>
          <p id={`${id}-payee-hint`} className="text-sm text-muted-foreground">{words.payeeHint}</p>
          <input id={`${id}-payee`} aria-describedby={`${id}-payee-hint`} required maxLength={80} value={payee} disabled={pending} onChange={(event) => setPayee(event.target.value)} className={inputClass} />
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-amount`} className="font-medium">{words.amountLabel}</label>
          <p id={`${id}-amount-hint`} className="text-sm text-muted-foreground">{words.amountHint}</p>
          <input id={`${id}-amount`} aria-describedby={`${id}-amount-hint`} inputMode="decimal" autoComplete="off" maxLength={14} value={amount} disabled={pending} onChange={(event) => setAmount(event.target.value)} className={inputClass} />
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-claim`} className="font-medium">{words.claimLabel}</label>
          <p id={`${id}-claim-hint`} className="text-sm text-muted-foreground">{words.claimHint}</p>
          <textarea id={`${id}-claim`} aria-describedby={`${id}-claim-hint`} rows={3} maxLength={400} value={claim} disabled={pending} onChange={(event) => setClaim(event.target.value)} className={`${inputClass} min-h-24 py-2`} />
        </div>
        <Button type="submit" disabled={pending || payee.trim() === ""} className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start">
          <ShieldCheckIcon aria-hidden="true" />
          {pending ? words.checking : words.submit}
        </Button>
        {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error as keyof typeof copy.errors] ?? copy.errors.unavailable}</p> : null}
        {result ? (
          <div role="status" className="min-w-0 space-y-3 rounded-xl border bg-secondary/40 p-4">
            <VerdictPill verdict={result.verdict} payeeId={result.payeeId} labels={words.verdicts} />
            <p className="wrap-anywhere text-sm">{result.words}</p>
            <ProvenanceBadge provenance={result.provenance} kind="worded" copy={ai} />
            <p className="text-sm text-muted-foreground">{fill(words.told, { count: String(result.told) })}</p>
            {speech ? <HearButton label={words.hear} speaking={copy.read.hearing} request={{ kind: "claim", claimCheckId: result.claimCheckId }} locale={locale} speech={speech} /> : null}
          </div>
        ) : null}
      </form>
    </Panel>
  );
}
