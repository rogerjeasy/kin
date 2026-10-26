"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { useBillingRequest } from "./use-billing-request";

type Props = {
  memberId: string;
  name: string;
  rate: string;
  payees: readonly { id: string; name: string }[];
  configuredPayeeId: string | null;
  /** The recorded PayPal address, masked, or `null` when none is recorded. */
  receiver: string | null;
  copy: Dictionary["dashboard"]["caregiverBilling"];
};

/** An organizer records one caregiver's rate without changing payment permissions. */
export function RateForm({ memberId, name, rate, payees, configuredPayeeId, receiver, copy }: Props) {
  const { send, pending, error } = useBillingRequest(copy.errors);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const prefix = `rate-${memberId}`;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const data = new FormData(event.currentTarget);
    const result = await send({ operation: "configure", memberId, payeeId: data.get("payee") ?? configuredPayeeId ?? payees[0]?.id ?? null, name: data.get("name"), rate: data.get("rate"), receiver: data.get("receiver") ?? "" });
    if (result.ok) { setSaved(true); router.refresh(); }
  }
  return (
    <form onSubmit={save} className="grid min-w-0 gap-4 rounded-xl border p-4" aria-label={name}>
      <h3 className="font-semibold wrap-anywhere">{name}</h3>
      <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field id={`${prefix}-name`} label={copy.name}>
          <input id={`${prefix}-name`} name="name" defaultValue={name} required maxLength={80} className={inputClass} />
        </Field>
        <Field id={`${prefix}-rate`} label={copy.rate}>
          <input id={`${prefix}-rate`} name="rate" type="text" inputMode="decimal" defaultValue={rate} required maxLength={20} className={inputClass} />
        </Field>
        <Field id={`${prefix}-receiver`} label={copy.receiver} hint={receiver === null ? copy.receiverNone : fill(copy.receiverRecorded, { address: receiver })}>
          <input id={`${prefix}-receiver`} name="receiver" type="email" aria-describedby={`${prefix}-receiver-hint`} autoComplete="off" maxLength={127} placeholder={copy.receiverPlaceholder} className={inputClass} />
        </Field>
        {payees.length > 1 && configuredPayeeId === null ? (
          <Field id={`${prefix}-payee`} label={copy.payee}>
            <select id={`${prefix}-payee`} name="payee" required defaultValue="" className={inputClass}>
              <option value="" disabled>{copy.choosePayee}</option>
              {payees.map((payee) => <option key={payee.id} value={payee.id}>{payee.name}</option>)}
            </select>
          </Field>
        ) : null}
      </fieldset>
      {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
      {saved ? <p role="status" className="text-sm text-positive">{copy.saved}</p> : null}
      <Button type="submit" disabled={pending} className="min-h-11 justify-self-start">{pending ? copy.saving : copy.save}</Button>
    </form>
  );
}
