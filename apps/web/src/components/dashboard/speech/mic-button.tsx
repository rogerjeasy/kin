"use client";

import { MicIcon, SquareIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useRecorder } from "./use-recorder";

type Props = { label: string; copy: Dictionary["dashboard"]["speech"]; disabled?: boolean; onRecorded: (pcm: Uint8Array) => void };

/** Speak, then Stop: hands the recording on. Says plainly when the microphone is refused. */
export function MicButton({ label, copy, disabled = false, onRecorded }: Props) {
  const { state, record, stop } = useRecorder();
  async function start() {
    const pcm = await record();
    if (pcm !== null && pcm.byteLength > 0) onRecorded(pcm);
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      {state === "recording" ? (
        <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start" onClick={stop}>
          <SquareIcon aria-hidden="true" />
          {copy.stop}
        </Button>
      ) : (
        <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start" disabled={disabled} onClick={start}>
          <MicIcon aria-hidden="true" />
          {label}
        </Button>
      )}
      {state === "recording" ? <p role="status" className="text-sm text-muted-foreground">{copy.listening}</p> : null}
      {state === "denied" ? <p role="alert" className="text-sm text-danger">{copy.micDenied}</p> : null}
    </div>
  );
}
