"use client";

import { Volume2Icon } from "lucide-react";
import { useState } from "react";

import { SpeechStatus } from "@/components/dashboard/speech/speech-status";
import { speak } from "@/components/dashboard/speech/speech-client";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

type Props = {
  label: string;
  /** What to read aloud: the server rebuilds the words from the record, so this only names them. */
  request: { kind: "letter"; documentId: string } | { kind: "claim"; claimCheckId: string };
  locale: Locale;
  speech: Dictionary["dashboard"]["speech"];
  /** The label while Kin speaks. */
  speaking: string;
};

/** Plays what Kin has to say about a letter or a checked demand, and says plainly when it cannot. */
export function HearButton({ label, request, locale, speech, speaking }: Props) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function hear() {
    setError(null);
    setWorking(true);
    const result = await speak({ ...request, locale });
    setWorking(false);
    if (!result.ok) setError(result.reason);
  }
  return (
    <div className="min-w-0 space-y-2">
      <Button type="button" variant="outline" disabled={working} className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start" onClick={hear}>
        <Volume2Icon aria-hidden="true" />
        {working ? speaking : label}
      </Button>
      <SpeechStatus copy={speech} working={false} error={error} note={null} />
    </div>
  );
}
