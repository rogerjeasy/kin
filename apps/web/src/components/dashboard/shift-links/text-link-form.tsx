"use client";

import { SendIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { useShiftRequest } from "@/components/dashboard/shifts/use-shift-request";
import { Button } from "@/components/ui/button";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import type { MadeLink } from "@/server/shift-links";

type Props = { shiftId: string; locale: Locale; copy: Dictionary["dashboard"]["shiftLinks"]; shifts: ShiftCopy; idPrefix: string; onMade: (link: MadeLink) => void };

/**
 * Makes a link and texts it to a number typed here. The number goes to the
 * server in this one request and is not kept: it is not stored, logged or sent
 * back, and the field is emptied once the text has gone.
 */
export function TextLinkForm({ shiftId, locale, copy, shifts, idPrefix, onMade }: Props) {
  const { send, pending, error } = useShiftRequest();
  const [outcome, setOutcome] = useState<"sent" | "failed" | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOutcome(null);
    const element = event.currentTarget;
    const reply = await send({ operation: "check_link", shiftId, locale, phone: new FormData(element).get("phone") ?? "" });
    if (!reply.ok || !("link" in reply)) return;
    onMade(reply.link);
    setOutcome(reply.link.text === "sent" ? "sent" : "failed");
    if (reply.link.text === "sent") element.reset();
  }

  const inputId = `${idPrefix}-phone`;
  return (
    <form onSubmit={submit} className="grid min-w-0 gap-3 sm:max-w-md" aria-busy={pending}>
      <h4 className="font-semibold">{copy.textTitle}</h4>
      <Field id={inputId} label={copy.phone} hint={copy.phoneHint}>
        <input id={inputId} name="phone" type="tel" inputMode="tel" required maxLength={24} autoComplete="off" dir="ltr" aria-describedby={`${inputId}-hint`} className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending} className="justify-self-start">
        <SendIcon aria-hidden="true" className="rtl:-scale-x-100" />
        {pending ? copy.sending : copy.send}
      </Button>
      {error ? <p role="alert" className="text-sm text-danger">{failureText(shifts, error)}</p> : null}
      {outcome === "sent" ? <p role="status" className="text-sm text-positive">{copy.sent}</p> : null}
      {outcome === "failed" ? <p role="alert" className="text-sm text-danger">{copy.textFailed}</p> : null}
    </form>
  );
}
