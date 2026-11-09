"use client";

import { ExternalLinkIcon, SmartphoneIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type Props = { copy: Dictionary["dashboard"]["presence"]; phone: { readonly link: string; readonly text: string; readonly name: string }; token: string };

async function answer(token: string, choice: "me" | "not_me"): Promise<boolean> {
  try {
    const response = await fetch("/api/presence-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, answer: choice }) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * What a family member's own phone would show, for a demo circle, where no real
 * text is sent: the message and its two answers. The buttons take the same public
 * route the real person's page takes, so the demo shows the real mechanism end
 * to end. A real circle never shows this: its link goes only to the real person.
 */
export function FamilyPhone({ copy, phone, token }: Props) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function tap(choice: "me" | "not_me") {
    setPending(true);
    setSent(await answer(token, choice));
    setPending(false);
  }

  return (
    <section aria-label={fill(copy.phone.title, { name: phone.name })} className="min-w-0 space-y-4 rounded-2xl border-2 border-dashed bg-card p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        <SmartphoneIcon aria-hidden="true" className="size-5 shrink-0" />
        <span className="min-w-0">{fill(copy.phone.title, { name: phone.name })}</span>
      </h3>
      <p className="text-sm text-muted-foreground">{fill(copy.phone.demoNote, { name: phone.name })}</p>
      <p dir="auto" className="rounded-xl bg-secondary p-3 text-base whitespace-pre-line wrap-anywhere">{phone.text}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" disabled={pending || sent} onClick={() => void tap("me")} className="h-auto min-h-14 whitespace-normal text-lg">
          {copy.phone.yes}
        </Button>
        <Button type="button" variant="outline" disabled={pending || sent} onClick={() => void tap("not_me")} className="h-auto min-h-14 whitespace-normal text-lg">
          {copy.phone.no}
        </Button>
      </div>
      {sent ? <p role="status" className="text-sm font-medium">{copy.phone.sent}</p> : null}
      <a href={phone.link} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline underline-offset-4">
        <ExternalLinkIcon aria-hidden="true" className="size-4 shrink-0" />
        {fill(copy.phone.open, { name: phone.name })}
      </a>
    </section>
  );
}
