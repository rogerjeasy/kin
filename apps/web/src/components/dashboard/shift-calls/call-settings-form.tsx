"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { useShiftRequest } from "@/components/dashboard/shifts/use-shift-request";
import { Button } from "@/components/ui/button";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";
import type { Dictionary } from "@/i18n/dictionary";

export type CallSettingsState = "on" | "off" | "not_set" | "unknown";

type Props = {
  copy: Dictionary["dashboard"]["shiftCalls"]["settings"];
  shifts: ShiftCopy;
  state: CallSettingsState;
  /** Whether the viewer may switch the call on: the parent, or in a demo the organizer playing her. */
  canEnable: boolean;
  /** Already worded from the record: who agreed and when, or `null`. */
  consentLine: string | null;
  /** Already worded from the record: the quiet hours and the two tries. */
  rulesLine: string;
  onlyParentLine: string;
};

/**
 * Switching Kin's call to the parent on needs her number and her explicit
 * agreement; switching it off is one tap. The number is write-only: it goes to
 * the server once, the field is emptied, and the screen only ever says that a
 * number is saved.
 */
export function CallSettingsForm({ copy, shifts, state, canEnable, consentLine, rulesLine, onlyParentLine }: Props) {
  const { send, pending, error } = useShiftRequest();
  const router = useRouter();
  const [done, setDone] = useState<"saved" | "stopped" | null>(null);

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(null);
    const element = event.currentTarget;
    const form = new FormData(element);
    const reply = await send({ operation: "call_settings", enabled: true, phone: form.get("phone") ?? "", consent: form.get("consent") === "on" });
    if (!reply.ok) return;
    element.reset();
    setDone("saved");
    router.refresh();
  }

  async function disable() {
    setDone(null);
    const reply = await send({ operation: "call_settings", enabled: false });
    if (!reply.ok) return;
    setDone("stopped");
    router.refresh();
  }

  const status = state === "on" ? copy.on : state === "off" ? copy.off : state === "not_set" ? copy.notSet : null;
  return (
    <div className="min-w-0 space-y-5" aria-busy={pending}>
      {status ? <p className="font-medium text-pretty">{status}</p> : null}
      {consentLine ? <p className="text-sm text-muted-foreground text-pretty">{consentLine}</p> : null}
      <p className="text-sm text-muted-foreground text-pretty">{rulesLine}</p>
      {canEnable ? (
        <form onSubmit={enable} className="grid min-w-0 gap-4 sm:max-w-md">
          <fieldset disabled={pending} className="grid min-w-0 gap-4">
            <Field id="call-phone" label={copy.phone} hint={copy.phoneHint}>
              <input id="call-phone" name="phone" type="tel" inputMode="tel" required maxLength={24} autoComplete="off" dir="ltr" aria-describedby="call-phone-hint" className={inputClass} />
            </Field>
            <label className="flex min-w-0 items-start gap-3 text-pretty">
              <input name="consent" type="checkbox" required className="mt-0.5 size-6 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
              <span className="min-w-0">{copy.consent}</span>
            </label>
          </fieldset>
          <Button type="submit" disabled={pending} className="justify-self-start">
            {pending ? copy.enabling : copy.enable}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground text-pretty">{onlyParentLine}</p>
      )}
      {state !== "off" && state !== "not_set" ? (
        <Button type="button" variant="outline" disabled={pending} onClick={disable}>
          {pending ? copy.disabling : copy.disable}
        </Button>
      ) : null}
      {error ? <p role="alert" className="text-sm text-danger">{failureText(shifts, error)}</p> : null}
      {done ? <p role="status" className="text-sm text-positive">{done === "saved" ? copy.saved : copy.stopped}</p> : null}
    </div>
  );
}
