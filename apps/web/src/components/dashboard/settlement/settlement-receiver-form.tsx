"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { useSettlementRequest } from "./use-settlement-request";
import { formWell } from "./form-well.ts";

type Props = {
  /** The address on record, masked, or `null`. */
  receiver: string | null;
  copy: Dictionary["dashboard"]["fairness"]["settlementRun"];
  errors: Dictionary["dashboard"]["fairness"]["errors"];
};

/**
 * A member says where their own settlement payout goes. Only they can, and
 * the address cannot change while a payout to them is waiting or under way.
 * The recorded address is shown masked; the field starts empty.
 */
export function SettlementReceiverForm({ receiver, copy, errors }: Props) {
  const { send, pending, error } = useSettlementRequest();
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = event.currentTarget;
    const result = await send({ operation: "receiver", email: new FormData(form).get("email") ?? "" });
    if (result.ok) {
      setSaved(true);
      form.reset();
      router.refresh();
    }
  }
  const hint = receiver === null ? copy.receiverNone : fill(copy.receiverRecorded, { address: receiver });
  return (
    <form onSubmit={save} className={`${formWell} sm:max-w-md`} aria-busy={pending} aria-labelledby="settlement-receiver-title">
      <div>
        <h3 id="settlement-receiver-title" className="font-semibold">{copy.receiverTitle}</h3>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{copy.receiverText}</p>
      </div>
      <fieldset disabled={pending} className="min-w-0">
        <Field id="settlement-receiver" label={copy.receiver} hint={hint}>
          <input id="settlement-receiver" name="email" type="email" required autoComplete="email" maxLength={127} placeholder={copy.receiverPlaceholder} aria-describedby="settlement-receiver-hint" className={inputClass} />
        </Field>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-danger">{errors[error]}</p> : null}
      {saved ? <p role="status" className="text-sm text-positive">{copy.receiverSaved}</p> : null}
      <Button type="submit" disabled={pending} className="min-h-11 justify-self-start">{pending ? copy.receiverSaving : copy.receiverSave}</Button>
    </form>
  );
}
