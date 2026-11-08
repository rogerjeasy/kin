"use client";

import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useInvoiceRequest } from "./use-invoice-request";

type Props = {
  /** The members an organizer may ask: those who share the cost, never oneself. */
  members: readonly { readonly id: string; readonly name: string }[];
  /** The top-up limits, already formatted. */
  hint: string;
  copy: Dictionary["invoicing"];
};

/** An organizer asks a member for a top-up by PayPal invoice. The amount is read again, digit by digit, on the server. */
export function InvoiceTopUpForm({ members, hint, copy }: Props) {
  const { send, pending, error } = useInvoiceRequest();
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(false);
    const form = event.currentTarget;
    const data = new FormData(form);
    const reply = await send({ operation: "request", id: crypto.randomUUID(), memberId: String(data.get("member") ?? ""), purpose: "top_up", amount: String(data.get("amount") ?? "").trim() });
    if (reply.ok) {
      setSent(true);
      form.reset();
    }
  }
  return (
    <form onSubmit={submit} className="grid min-w-0 gap-4 rounded-xl border p-4 sm:p-5" aria-busy={pending} aria-labelledby="invoice-top-up-title" noValidate>
      <div>
        <h3 id="invoice-top-up-title" className="font-semibold">{copy.topUp.title}</h3>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{copy.topUp.text}</p>
      </div>
      <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field id="invoice-member" label={copy.topUp.member}>
          <select id="invoice-member" name="member" required className={inputClass}>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="invoice-amount" label={copy.topUp.amount} hint={hint}>
          <input id="invoice-amount" name="amount" type="text" inputMode="decimal" required maxLength={12} aria-describedby="invoice-amount-hint" className={inputClass} />
        </Field>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-pretty text-danger">{copy.errors[error]}</p> : null}
      {sent ? <p role="status" className="text-sm text-positive">{copy.topUp.sent}</p> : null}
      <Button type="submit" disabled={pending} className="h-auto min-h-11 max-w-full justify-self-start whitespace-normal py-2 text-start">{pending ? copy.topUp.submitting : copy.topUp.submit}</Button>
    </form>
  );
}
