"use client";

import { Volume2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MicButton } from "@/components/dashboard/speech/mic-button";
import { answerByVoice, speak } from "@/components/dashboard/speech/speech-client";
import { SpeechStatus } from "@/components/dashboard/speech/speech-status";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

type Props = { locale: Locale; proposalId: string; copy: Dictionary["dashboard"]["approvals"]["voice"]; speech: Dictionary["dashboard"]["speech"]; outcomes: Readonly<Record<string, string>> };

/**
 * A spoken answer, in the demo: Kin reads the proposal, the person answers,
 * Kin reads back what it heard, and records it only after a clear spoken
 * yes to that (docs/architecture.md section 10.5). The server hears both
 * answers itself; the browser only carries the audio.
 */
export function VoiceAnswer({ locale, proposalId, copy, speech, outcomes }: Props) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<"approve" | "reject" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  async function run<T>(work: () => Promise<T>): Promise<T> {
    setError(null);
    setWorking(true);
    try {
      return await work();
    } finally {
      setWorking(false);
    }
  }
  async function listen() {
    const result = await run(() => speak({ kind: "proposal", proposalId, locale }));
    if (!result.ok) setError(result.reason);
  }
  async function answer(pcm: Uint8Array) {
    const result = await run(() => answerByVoice(pcm, { proposal: proposalId, locale, step: "answer" }));
    if (!result.ok) return setError(result.reason);
    setHeard(result.decision);
    const readBack = await run(() => speak({ kind: "proposal", proposalId, locale, decision: result.decision }));
    if (!readBack.ok) setError(readBack.reason);
  }
  async function confirm(pcm: Uint8Array) {
    if (heard === null) return;
    const result = await run(() => answerByVoice(pcm, { proposal: proposalId, locale, step: "confirm", decision: heard }));
    if (!result.ok) return setError(result.reason);
    setDone(outcomes[result.outcome] ?? null);
    router.refresh();
  }

  return (
    <div className="min-w-0 basis-full space-y-3 rounded-xl border border-dashed p-3">
      <div className="flex flex-wrap gap-3">
        {heard === null ? (
          <>
            <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start" disabled={working} onClick={listen}>
              <Volume2Icon aria-hidden="true" />
              {copy.start}
            </Button>
            <MicButton label={speech.record} copy={speech} disabled={working} onRecorded={answer} />
          </>
        ) : (
          <MicButton label={copy.confirm} copy={speech} disabled={working || done !== null} onRecorded={confirm} />
        )}
      </div>
      <SpeechStatus copy={speech} working={working} error={error} note={done ?? (heard === null ? null : heard === "approve" ? copy.heardApprove : copy.heardReject)} />
    </div>
  );
}
