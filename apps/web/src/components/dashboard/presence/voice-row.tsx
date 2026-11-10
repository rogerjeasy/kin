"use client";

import { SendIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postLetterJson } from "@/components/dashboard/letters/letter-client";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type Props = {
  voice: { readonly id: string; readonly name: string; readonly relationship: string; readonly confirmed: boolean; readonly simulated: boolean; readonly aliases: readonly string[]; readonly accountConfirmed: boolean };
  copy: Dictionary["dashboard"]["presence"]["voices"];
  /** Whether the viewer may remove a person: the organizer and the parent. */
  canRemove: boolean;
};

/** One person Kin may ask, with whether their number is confirmed, and a button to remove them for those who may. */
export function VoiceRow({ voice, copy, canRemove }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function remove() {
    setPending(true);
    await postLetterJson("/api/presence/voices", { operation: "remove", id: voice.id });
    setPending(false);
    router.refresh();
  }

  async function reconfirm() {
    setPending(true);
    const reply = await postLetterJson("/api/presence/voices", { operation: "reconfirm", id: voice.id });
    setPending(false);
    setSent(reply.ok);
  }

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-4 first:pt-0 last:pb-0">
      <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary font-serif text-lg ring-1 ring-border">
        {Array.from(voice.name)[0]}
      </span>
      <span className="min-w-0 flex-1 basis-40 font-medium wrap-anywhere">
        {voice.name} <span className="font-normal text-muted-foreground">· {voice.relationship}</span>
        {voice.aliases.length === 0 ? null : <span className="block text-sm font-normal text-muted-foreground">{fill(copy.aliasesLine, { aliases: voice.aliases.join(", ") })}</span>}
      </span>
      <StatusPill tone={voice.confirmed ? "positive" : "waiting"}>{voice.simulated ? copy.standIn : voice.confirmed ? copy.confirmed : copy.waiting}</StatusPill>
      <StatusPill tone={voice.accountConfirmed ? "positive" : "neutral"}>{voice.accountConfirmed ? copy.accountOn : copy.accountOff}</StatusPill>
      {canRemove && !voice.simulated ? (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void reconfirm()} aria-label={fill(copy.reconfirmFor, { name: voice.name })} className="min-h-11">
          <SendIcon aria-hidden="true" />
          {copy.reconfirm}
        </Button>
      ) : null}
      {sent ? <span role="status" className="basis-full text-sm font-medium">{copy.reconfirmed}</span> : null}
      {canRemove ? (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void remove()} aria-label={fill(copy.removeFor, { name: voice.name })} className="min-h-11">
          <Trash2Icon aria-hidden="true" />
          {copy.remove}
        </Button>
      ) : null}
    </li>
  );
}
