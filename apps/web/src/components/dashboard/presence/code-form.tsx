"use client";

import { KeyRoundIcon } from "lucide-react";
import { useId, useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { postLetterJson, type LetterError } from "@/components/dashboard/letters/letter-client";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

type Props = { locale: Locale; checkId: string; copy: Dictionary["dashboard"]["presence"] };

/**
 * When the real person could not be reached: the parent puts this week's family code to the caller and types what they
 * say. The server compares it with the three words and answers with one fixed sentence. What she types is data, and is
 * neither kept nor obeyed; the code itself is never sent back.
 */
export function CodeForm({ locale, checkId, copy }: Props) {
  const id = useId();
  const [said, setSaid] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);

  async function check() {
    setPending(true);
    setError(null);
    setAnswer(null);
    const reply = await postLetterJson<{ ok: true; replyText: string }>("/api/presence/code", { id: checkId, locale, said });
    setPending(false);
    if (reply.ok) setAnswer(reply.replyText);
    else setError((reply as LetterError).reason);
  }

  return (
    <form
      className="min-w-0 space-y-3 rounded-3xl border bg-card p-4 shadow-sm motion-safe:animate-fade-up sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void check();
      }}
    >
      <h3 className="flex items-center gap-2 font-semibold">
        <KeyRoundIcon aria-hidden="true" className="size-5 shrink-0 text-highlight" />
        <span className="min-w-0">{copy.code.askTitle}</span>
      </h3>
      <p className="text-sm text-muted-foreground">{copy.code.askText}</p>
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${id}-said`} className="font-medium">{copy.code.label}</label>
        <input id={`${id}-said`} dir="auto" autoComplete="off" required maxLength={400} value={said} disabled={pending} onChange={(event) => setSaid(event.target.value)} className={inputClass} />
      </div>
      <Button type="submit" disabled={pending || said.trim() === ""} className="h-auto min-h-11 max-w-full whitespace-normal text-start">
        {pending ? copy.code.checking : copy.code.submit}
      </Button>
      {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error as keyof typeof copy.errors] ?? copy.errors.unavailable}</p> : null}
      {answer ? <p role="status" className="font-serif text-2xl leading-snug text-pretty wrap-anywhere motion-safe:animate-scale-in">{answer}</p> : null}
    </form>
  );
}
