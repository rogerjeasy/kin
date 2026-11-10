"use client";

import { PlusIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useWishRequest } from "./use-wish-request";

type Props = { readonly copy: Dictionary["dashboard"]["wishes"]; readonly demo: boolean };

const FIELD = "min-h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The organizer tells Kin about a subscription the parent pays. A real one names its PayPal subscription; the server decides. */
export function AddSubscriptionForm({ copy, demo }: Props) {
  const id = useId();
  const text = copy.subscriptions.add;
  const { send, pending, error } = useWishRequest();
  const [added, setAdded] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const reply = await send({ operation: "subscription", name: String(form.get("name") ?? ""), monthly: String(form.get("monthly") ?? "").replace(",", "."), paypalSubscriptionId: demo ? null : String(form.get("paypal") ?? "") });
    setAdded(reply.ok);
    if (reply.ok) element.reset();
  }

  return (
    <details className="mt-4 rounded-xl border px-4">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{text.title}</summary>
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-3 pb-4">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label htmlFor={`${id}-name`} className="flex min-w-0 flex-col gap-1 text-sm font-medium">
            {text.name}
            <input id={`${id}-name`} name="name" required maxLength={80} className={FIELD} />
          </label>
          <label htmlFor={`${id}-monthly`} className="flex min-w-0 flex-col gap-1 text-sm font-medium">
            {text.monthly}
            <input id={`${id}-monthly`} name="monthly" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" className={FIELD} />
          </label>
        </div>
        {demo ? null : (
          <label htmlFor={`${id}-paypal`} className="flex min-w-0 flex-col gap-1 text-sm font-medium">
            {text.paypal}
            <input id={`${id}-paypal`} name="paypal" pattern="I-[A-Z0-9]{6,34}" className={FIELD} aria-describedby={`${id}-paypal-hint`} />
            <span id={`${id}-paypal-hint`} className="text-xs font-normal text-muted-foreground">
              {text.paypalHint} {text.paypalOptional}
            </span>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" disabled={pending} className="h-auto min-h-11">
            <PlusIcon aria-hidden="true" />
            {text.submit}
          </Button>
          {added ? <p role="status" className="text-sm text-positive">{text.added}</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {copy.reasons[error]}
            </p>
          ) : null}
        </div>
      </form>
    </details>
  );
}
