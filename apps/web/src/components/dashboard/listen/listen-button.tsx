"use client";

import { Volume2Icon } from "lucide-react";
import { useState } from "react";

import { speak } from "@/components/dashboard/speech/speech-client";
import { SpeechStatus } from "@/components/dashboard/speech/speech-status";
import { Button } from "@/components/ui/button";
import type { AnnounceEvery } from "@/content/circle/announcements";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

type Props = {
  every: AnnounceEvery;
  locale: Locale;
  copy: Dictionary["dashboard"]["listen"];
  speech: Dictionary["dashboard"]["speech"];
};

/** One large button: Kin reads what is on the screen aloud. The words are built on the server from the record. */
export function ListenButton({ every, locale, copy, speech }: Props) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function listen() {
    setError(null);
    setWorking(true);
    const result = await speak({ kind: "announcement", every, locale });
    setWorking(false);
    if (!result.ok) setError(result.reason);
  }
  return (
    <div className="min-w-0 space-y-3">
      <Button type="button" className="h-auto min-h-16 w-full max-w-full whitespace-normal px-6 py-4 text-xl sm:w-auto" disabled={working} onClick={listen}>
        <Volume2Icon aria-hidden="true" className="size-6" />
        {working ? copy.playing : copy.play}
      </Button>
      <SpeechStatus copy={speech} working={false} error={error} note={null} />
    </div>
  );
}
