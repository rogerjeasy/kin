"use client";

import { Volume2Icon } from "lucide-react";
import { useState } from "react";
import type { CaregiverBillDetails } from "@kin/domain";

import { MicButton } from "@/components/dashboard/speech/mic-button";
import { speak, transcribe } from "@/components/dashboard/speech/speech-client";
import { SpeechStatus } from "@/components/dashboard/speech/speech-status";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";

type Props = {
  locale: Locale;
  details: CaregiverBillDetails;
  copy: Dictionary["dashboard"]["caregiverBilling"]["speech"];
  speech: Dictionary["dashboard"]["speech"];
  disabled: boolean;
  onYes: () => void;
  onNo: () => void;
};

/**
 * The reviewed bill, read aloud from the server's own calculation, and a
 * spoken yes or no to it. A yes does exactly what the Submit button does.
 */
export function BillVoice({ locale, details, copy, speech, disabled, onYes, onNo }: Props) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function listen() {
    setError(null);
    setWorking(true);
    const result = await speak({ kind: "bill", details, locale });
    setWorking(false);
    if (!result.ok) setError(result.reason);
  }
  async function answer(pcm: Uint8Array) {
    setError(null);
    setWorking(true);
    const result = await transcribe(pcm, locale);
    setWorking(false);
    if (!result.ok) return setError(result.reason);
    const heard = fill(speech.heard, { transcript: result.transcript });
    if (result.answer === "yes") {
      setNote(`${heard} ${copy.saidYes}`);
      onYes();
    } else if (result.answer === "no") {
      setNote(`${heard} ${copy.saidNo}`);
      onNo();
    } else {
      setNote(heard);
      setError("unclear");
    }
  }
  return (
    <div className="min-w-0 space-y-3 rounded-2xl border border-dashed bg-muted/50 p-4">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start" disabled={disabled || working} onClick={listen}>
          <Volume2Icon aria-hidden="true" />
          {copy.hearBill}
        </Button>
        <MicButton label={copy.answer} copy={speech} disabled={disabled || working} onRecorded={answer} />
      </div>
      <SpeechStatus copy={speech} working={working} error={error} note={note} />
    </div>
  );
}
