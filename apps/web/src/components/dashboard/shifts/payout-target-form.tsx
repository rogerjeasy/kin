"use client";

import type { PayoutWallet } from "@kin/db";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";
import { fill } from "@/i18n/template";

import { useShiftRequest } from "./use-shift-request";

type Props = {
  copy: ShiftCopy;
  /** The wallets Kin can pay into, from the database package, since the browser never imports it. */
  wallets: readonly PayoutWallet[];
  /** The wallet on record and the address masked, as the snapshot gives them; the full address is never sent back. */
  current: { readonly wallet: PayoutWallet; readonly address: string | null };
  /** What to say beside the Venmo choice, already worded: PayPal's sandbox refuses it, or a demo only simulates it. `null` when there is nothing to warn of. */
  venmoNote: string | null;
};

/**
 * The caregiver says where their own pay goes. Only they can, and the address
 * cannot change while a payment to them waits or is under way. The recorded
 * address is shown masked and the field starts empty.
 */
export function PayoutTargetForm({ copy, wallets, current, venmoNote }: Props) {
  const form = copy.target;
  const [wallet, setWallet] = useState<PayoutWallet>(current.wallet);
  const [saved, setSaved] = useState(false);
  const { send, pending, error } = useShiftRequest();
  const router = useRouter();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const element = event.currentTarget;
    const reply = await send({ operation: "target", wallet, receiver: new FormData(element).get("receiver") ?? "" });
    if (reply.ok) {
      setSaved(true);
      element.reset();
      router.refresh();
    }
  }

  const recorded = current.address === null ? form.none : fill(form.current, { wallet: copy.payment.wallets[current.wallet], address: current.address });
  return (
    <Panel title={form.title} description={form.text}>
      <form onSubmit={save} className="grid min-w-0 gap-4 sm:max-w-md" aria-busy={pending}>
        <fieldset disabled={pending} className="grid min-w-0 gap-4">
          <Field id="target-wallet" label={form.wallet}>
            <select id="target-wallet" value={wallet} onChange={(event) => setWallet(wallets.find((each) => each === event.target.value) ?? "paypal")} className={inputClass}>
              {wallets.map((each) => (
                <option key={each} value={each}>{copy.payment.wallets[each]}</option>
              ))}
            </select>
          </Field>
          <Field id="target-receiver" label={form.address} hint={wallet === "venmo" ? form.hintVenmo : form.hintPaypal}>
            <input id="target-receiver" name="receiver" type={wallet === "venmo" ? "text" : "email"} required maxLength={127} autoComplete="off" aria-describedby="target-receiver-hint" className={inputClass} />
          </Field>
        </fieldset>
        {wallet === "venmo" && venmoNote !== null ? <p role="note" className="rounded-lg border border-highlight/40 bg-highlight/5 p-3 text-sm font-medium text-pretty">{venmoNote}</p> : null}
        <p className="text-sm text-muted-foreground text-pretty">{recorded}</p>
        {error ? <p role="alert" className="text-sm text-danger">{failureText(copy, error)}</p> : null}
        {saved ? <p role="status" className="text-sm text-positive">{form.saved}</p> : null}
        <Button type="submit" disabled={pending} className="min-h-11 justify-self-start">
          {pending ? form.saving : form.save}
        </Button>
      </form>
    </Panel>
  );
}
