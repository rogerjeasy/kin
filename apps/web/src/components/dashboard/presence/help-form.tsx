"use client";

import { HandHeartIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { postLetterJson, type LetterError } from "@/components/dashboard/letters/letter-client";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";

type Props = {
  locale: Locale;
  checkId: string;
  name: string;
  /** What the caller asked for, formatted: help is never more. `null` when no amount was named. */
  max: string | null;
  copy: Dictionary["dashboard"]["presence"];
  approvalsHref: string;
};

/**
 * After "yes, it was me": the family may ask to help that person. The amount is what the family types; the server asks
 * the approval engine who must say yes, and the database refuses anything but the account the person confirmed. This form
 * carries words; it can name no address.
 */
export function HelpForm({ locale, checkId, name, max, copy, approvalsHref }: Props) {
  const id = useId();
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raised, setRaised] = useState(false);

  async function ask() {
    setPending(true);
    setError(null);
    const reply = await postLetterJson<{ ok: true }>("/api/presence/help", { id: checkId, locale, amount });
    setPending(false);
    if (reply.ok) setRaised(true);
    else setError((reply as LetterError).reason);
  }

  if (raised) {
    return (
      <div role="status" className="min-w-0 space-y-2">
        <p className="text-sm font-medium">{copy.help.raised}</p>
        <Link href={approvalsHref} className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">
          {copy.help.open}
        </Link>
      </div>
    );
  }

  return (
    <form
      className="min-w-0 space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void ask();
      }}
    >
      <h3 className="flex items-center gap-2 font-semibold">
        <HandHeartIcon aria-hidden="true" className="size-5 shrink-0" />
        <span className="min-w-0">{fill(copy.help.title, { name })}</span>
      </h3>
      <p className="text-sm text-muted-foreground">{fill(copy.help.text, { name })}</p>
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${id}-amount`} className="font-medium">{copy.help.amountLabel}</label>
        <p id={`${id}-amount-hint`} className="text-sm text-muted-foreground">{max === null ? copy.help.amountAny : fill(copy.help.amountHint, { max })}</p>
        <input id={`${id}-amount`} aria-describedby={`${id}-amount-hint`} inputMode="decimal" autoComplete="off" required maxLength={20} value={amount} disabled={pending} onChange={(event) => setAmount(event.target.value)} className={inputClass} />
      </div>
      <Button type="submit" disabled={pending || amount.trim() === ""} className="h-auto min-h-11 max-w-full whitespace-normal text-start">
        {pending ? copy.help.sending : copy.help.submit}
      </Button>
      {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error as keyof typeof copy.errors] ?? copy.errors.unavailable}</p> : null}
    </form>
  );
}
