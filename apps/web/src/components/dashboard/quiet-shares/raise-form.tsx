"use client";

import { MAX_ASK_TITLE, QUIET_SHARE_KINDS, type QuietShareKind } from "@kin/domain";
import { HandCoinsIcon } from "lucide-react";
import { useId, useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";

import type { QuietCopy } from "./quiet-screen";
import { useQuietShare } from "./use-quiet-share";

/** The organizer asks the family to cover a cost. Only the title and the amount are written; who is asked comes from the agreement. */
export function RaiseForm({ copy }: { copy: QuietCopy }) {
  const words = copy.raise;
  const id = useId();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<QuietShareKind>("one_off");
  const [done, setDone] = useState(false);
  const { send, pending, error } = useQuietShare(null);

  async function raise() {
    setDone(false);
    const reply = await send({ operation: "raise", title, amount, kind });
    if (reply.ok) {
      setDone(true);
      setTitle("");
      setAmount("");
    }
  }

  return (
    <Panel title={words.title} description={words.text}>
      <form
        className="grid min-w-0 gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void raise();
        }}
      >
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-title`} className="font-medium">{words.titleLabel}</label>
          <p id={`${id}-title-hint`} className="text-sm text-muted-foreground">{words.titleHint}</p>
          <input id={`${id}-title`} aria-describedby={`${id}-title-hint`} dir="auto" required maxLength={MAX_ASK_TITLE} value={title} disabled={pending} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-amount`} className="font-medium">{words.amountLabel}</label>
          <input id={`${id}-amount`} required inputMode="decimal" autoComplete="off" maxLength={12} value={amount} disabled={pending} onChange={(event) => setAmount(event.target.value)} className={`${inputClass} text-lg`} />
        </div>
        <fieldset className="min-w-0 space-y-1">
          <legend className="font-medium">{words.kindLabel}</legend>
          <div className="flex flex-wrap gap-2">
            {QUIET_SHARE_KINDS.map((each) => (
              <label key={each} htmlFor={`${id}-${each}`} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 transition-[border-color,background-color,box-shadow] duration-300 hover:border-input has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:checked]:shadow-[0_0_0_3px_rgb(var(--glow-gold)/0.18)]">
                <input id={`${id}-${each}`} type="radio" name={`${id}-kind`} value={each} checked={kind === each} onChange={() => setKind(each)} className="size-5 accent-primary" />
                {words.kinds[each]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || title.trim() === "" || amount.trim() === ""} className="h-auto min-h-12 max-w-full whitespace-normal">
            <HandCoinsIcon aria-hidden="true" />
            {pending ? words.submitting : words.submit}
          </Button>
          {done ? <p role="status" className="text-sm font-medium">{words.done}</p> : null}
          {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
        </div>
      </form>
    </Panel>
  );
}
