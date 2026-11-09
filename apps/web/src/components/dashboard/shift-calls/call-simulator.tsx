"use client";

import { PhoneCallIcon, Volume2Icon } from "lucide-react";
import { useId, useState } from "react";

import { speak } from "@/components/dashboard/speech/speech-client";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { Button } from "@/components/ui/button";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";

import { Keypad } from "./keypad";
import { PhoneLines } from "./phone-lines";
import { useCallScript } from "./use-call-script";

type Props = {
  shiftId: string;
  locale: Locale;
  /** The parent's name, from the record. */
  parent: string;
  copy: Dictionary["dashboard"]["shiftCalls"]["simulator"];
  shifts: ShiftCopy;
  /** Records the key pressed as the parent's answer on the call. `false` when it was refused. */
  onAnswer: (answer: "yes" | "no") => Promise<boolean>;
  /** The button's own look: the need card has room for a larger one. */
  large?: boolean;
};

/**
 * A demo circle never places a real call, so this plays what one would say, in
 * the viewer's language, and takes the key a person would press. The key is
 * recorded as the parent's answer, as on a real call: a yes is her word and
 * the real settlement runs; a no is a call she declined. It says plainly that
 * the call is simulated.
 */
export function CallSimulator({ shiftId, locale, parent, copy, shifts, onAnswer, large = false }: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState<"idle" | "playing" | "failed">("idle");
  const [recording, setRecording] = useState(false);
  const { call, load, pending, error } = useCallScript(shiftId, locale);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && call === null) await load();
  }

  async function play() {
    setListening("playing");
    const heard = await speak({ kind: "shift_call", shiftId, part: "question", locale });
    setListening(heard.ok ? "idle" : "failed");
  }

  async function answer(choice: "yes" | "no") {
    setRecording(true);
    const recorded = await onAnswer(choice);
    setRecording(false);
    if (recorded) setOpen(false);
  }

  return (
    <div className="min-w-0 space-y-3">
      <Button type="button" variant="outline" size={large ? "default" : "sm"} aria-expanded={open} aria-controls={panelId} onClick={toggle} className={large ? "h-auto min-h-14 w-full whitespace-normal py-3 text-lg sm:w-auto" : undefined}>
        <PhoneCallIcon aria-hidden="true" />
        {copy.open}
      </Button>
      {open ? (
        <section id={panelId} aria-label={fill(copy.title, { parent })} className="mx-auto min-w-0 max-w-sm space-y-4 rounded-3xl border-2 bg-secondary/40 p-4 sm:p-5">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="min-w-0 font-semibold text-pretty">{fill(copy.title, { parent })}</h3>
            <StatusPill tone="waiting" icon={PhoneCallIcon}>{copy.badge}</StatusPill>
          </header>
          <p className="text-sm text-muted-foreground text-pretty">{copy.note}</p>
          {pending ? <p role="status" className="text-sm text-muted-foreground">{copy.recording}</p> : null}
          {error ? <p role="alert" className="text-sm text-danger">{failureText(shifts, error)}</p> : null}
          {call ? (
            <>
              <PhoneLines label={copy.said} lines={[...call.opening, call.question]} />
              <Button type="button" variant="outline" size="sm" disabled={listening === "playing"} onClick={play}>
                <Volume2Icon aria-hidden="true" />
                {listening === "playing" ? copy.playing : listening === "idle" ? copy.play : copy.again}
              </Button>
              {listening === "failed" ? <p role="status" className="text-sm text-muted-foreground">{copy.listenFailed}</p> : null}
              <Keypad label={copy.keypad} yes={copy.yes} no={copy.no} disabled={recording} onYes={() => void answer("yes")} onNo={() => void answer("no")} />
              {recording ? <p role="status" className="text-sm text-muted-foreground">{copy.recording}</p> : null}
            </>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>{copy.close}</Button>
        </section>
      ) : null}
    </div>
  );
}
