"use client";

import { MicIcon, SquareIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { cn } from "@/lib/utils";

import { ListeningLine } from "./listening-line";
import { useRecorder } from "./use-recorder";

type Props = {
  label: string;
  copy: Dictionary["dashboard"]["speech"];
  disabled?: boolean;
  onRecorded: (pcm: Uint8Array) => void;
  /** Extra classes for the button, where speaking is the screen's first way in and it should be large. */
  className?: string;
};

/** Speak, then Stop: hands the recording on. Says plainly when the microphone is refused. */
export function MicButton({ label, copy, disabled = false, onRecorded, className }: Props) {
  const { state, record, stop } = useRecorder();
  async function start() {
    const pcm = await record();
    if (pcm !== null && pcm.byteLength > 0) onRecorded(pcm);
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      {state === "recording" ? (
        <Button type="button" variant="outline" className={cn("h-auto min-h-11 max-w-full shrink border-danger/60 whitespace-normal text-start ring-4 ring-danger/15", className)} onClick={stop}>
          <SquareIcon aria-hidden="true" />
          {copy.stop}
        </Button>
      ) : (
        <Button type="button" variant="outline" className={cn("h-auto min-h-11 max-w-full shrink whitespace-normal text-start", className)} disabled={disabled} onClick={start}>
          <MicIcon aria-hidden="true" className="text-highlight" />
          {label}
        </Button>
      )}
      {state === "recording" ? (
        <div className="flex min-w-0 flex-1 basis-60 text-sm text-muted-foreground">
          <ListeningLine text={copy.listening} />
        </div>
      ) : null}
      {state === "denied" ? <p role="alert" className="text-sm text-danger">{copy.micDenied}</p> : null}
    </div>
  );
}
