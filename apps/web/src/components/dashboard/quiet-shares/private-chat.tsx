"use client";

import { LockKeyholeIcon, SendIcon } from "lucide-react";
import { useId, useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { MicButton } from "@/components/dashboard/speech/mic-button";
import { transcribe } from "@/components/dashboard/speech/speech-client";
import { SpeechStatus } from "@/components/dashboard/speech/speech-status";
import { Button } from "@/components/ui/button";
import { fill } from "@/i18n/template";
import type { DraftForm } from "@/server/quiet-shares";
import { cn } from "@/lib/utils";

import type { QuietScreen } from "./quiet-screen";
import { useQuietShare } from "./use-quiet-share";

type Line = { readonly who: "you" | "kin"; readonly text: string };
type Props = { screen: QuietScreen; askId: string; title: string; examples: boolean; onDraft: (draft: DraftForm) => void };

const MAX_MESSAGES = 6;
const MAX_CHARS = 500;

/**
 * The person's private conversation with their own Kin. Only their own words
 * go to the server, once per turn, and nothing is kept there: the
 * conversation lives in this screen and is gone when it closes. Kin's answer
 * fills the offer below for the person to check.
 */
export function PrivateChat({ screen, askId, title, examples, onDraft }: Props) {
  const { copy, locale, speech } = screen;
  const chat = copy.chat;
  const id = useId();
  const [lines, setLines] = useState<Line[]>([{ who: "kin", text: fill(chat.intro, { title }) }]);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const { words, pending, error } = useQuietShare(screen.seat);

  async function tell(said: string) {
    const trimmed = said.trim().slice(0, MAX_CHARS);
    if (trimmed === "") return;
    const mine = [...lines.filter((line) => line.who === "you").map((line) => line.text), trimmed].slice(-MAX_MESSAGES);
    setLines((before) => [...before, { who: "you", text: trimmed }]);
    setText("");
    const reply = await words({ operation: "words", askId, messages: mine, locale });
    if (!reply.ok) return;
    setLines((before) => [...before, { who: "kin", text: reply.reply ?? (reply.heardAmount ? chat.heard : chat.noAmount) }]);
    onDraft(reply.draft);
  }

  async function heard(pcm: Uint8Array) {
    setSpeechError(null);
    setListening(true);
    const result = await transcribe(pcm, locale);
    setListening(false);
    if (!result.ok) return setSpeechError(result.reason);
    setText((before) => [before.trim(), result.transcript].filter((part) => part !== "").join(" ").slice(0, MAX_CHARS));
  }

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4 rounded-2xl border bg-secondary/50 p-4 shadow-[inset_0_1px_0_rgb(var(--sheen)/0.5)] sm:p-5">
      <div className="min-w-0">
        <h4 id={`${id}-title`} className="text-base font-semibold">{chat.title}</h4>
        <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
          <LockKeyholeIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{chat.private}</span>
        </p>
      </div>
      <ol aria-live="polite" className="min-w-0 space-y-2">
        {lines.map((line, index) => (
          <li key={index} className={cn("enter flex min-w-0", line.who === "you" ? "justify-end" : "justify-start")}>
            <p dir="auto" className={cn("max-w-[85%] rounded-3xl px-4 py-2.5 text-base wrap-anywhere shadow-xs", line.who === "you" ? "rounded-ee-md bg-primary text-primary-foreground" : "rounded-es-md border bg-card")}>
              <span className="sr-only">{line.who === "you" ? chat.you : chat.kin}: </span>
              {line.text}
            </p>
          </li>
        ))}
      </ol>
      {screen.canRead ? (
        <form
          className="min-w-0 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void tell(text);
          }}
        >
          {examples ? (
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-sm font-medium">{chat.examplesLabel}</legend>
              <div className="flex flex-wrap gap-2">
                {chat.examples.map((example) => {
                  const said = fill(example, { parent: screen.parent });
                  return (
                    <Button key={example} type="button" variant="outline" size="sm" disabled={pending} onClick={() => setText(said)} className="h-auto max-w-full whitespace-normal text-start">
                      {said}
                    </Button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
          <label htmlFor={`${id}-words`} className="sr-only">{chat.label}</label>
          <textarea id={`${id}-words`} dir="auto" rows={2} maxLength={MAX_CHARS} value={text} disabled={pending} onChange={(event) => setText(event.target.value)} className={`${inputClass} min-h-20 py-2`} />
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || text.trim() === ""} className="h-auto min-h-11 max-w-full whitespace-normal">
              <SendIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {pending ? chat.sending : chat.send}
            </Button>
            {speech ? <MicButton label={chat.speak} copy={speech} disabled={pending || listening} onRecorded={heard} /> : null}
          </div>
          {speech ? <SpeechStatus copy={speech} working={listening} error={speechError} note={null} /> : null}
          {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{chat.noModel}</p>
      )}
    </section>
  );
}
