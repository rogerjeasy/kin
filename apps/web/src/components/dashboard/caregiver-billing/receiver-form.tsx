"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { useBillingRequest } from "./use-billing-request";

type Props = { receiver: string | null; copy: Dictionary["dashboard"]["caregiverBilling"] };

/**
 * The caregiver says where their own pay goes. Only they can, and the
 * address cannot change while a payment to them is waiting or under way.
 * The recorded address is shown masked; the field starts empty.
 */
export function ReceiverForm({ receiver, copy }: Props) {
  const { send, pending, error } = useBillingRequest(copy.errors);
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
    <Panel title={copy.receiverTitle} description={copy.receiverText}>
      <form onSubmit={save} className="grid min-w-0 gap-4 sm:max-w-md" aria-busy={pending}>
        <fieldset disabled={pending} className="min-w-0">
          <Field id="receiver-email" label={copy.receiver} hint={hint}>
            <input id="receiver-email" name="email" type="email" required autoComplete="email" maxLength={127} placeholder={copy.receiverPlaceholder} aria-describedby="receiver-email-hint" className={inputClass} />
          </Field>
        </fieldset>
        {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
        {saved ? <p role="status" className="text-sm text-positive">{copy.receiverSaved}</p> : null}
        <Button type="submit" disabled={pending} className="min-h-11 justify-self-start">{pending ? copy.saving : copy.receiverSave}</Button>
      </form>
    </Panel>
  );
}
