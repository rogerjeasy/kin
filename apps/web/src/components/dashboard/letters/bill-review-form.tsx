"use client";

import { useId, useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useBillRequest } from "./use-bill-request";

type Copy = Dictionary["dashboard"]["letters"]["bills"];
/** What Kin read, to start the form from. The amount is already written as a decimal for the circle's currency. */
type Props = { billId: string; name: string; amount: string; dueOn: string | null; copy: Copy };

/**
 * A member who shares the cost checks what Kin read against the letter, and
 * says how the bill is paid: by PayPal to the company's address, which raises
 * a proposal the agreement's yeses decide, or outside Kin. Nothing here pays.
 */
export function BillReviewForm({ billId, name, amount, dueOn, copy }: Props) {
  const { send, pending, error } = useBillRequest(copy.errors);
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState<"paypal" | "outside">("paypal");
  const id = useId();
  const { review } = copy;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "");
    const done = await send({ operation: "review", billId, name: text("name"), amount: text("amount"), dueOn: text("dueOn") || null, receiver: how === "paypal" ? text("receiver") : null });
    if (done) setOpen(false);
  }
  if (!open) {
    return (
      <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(true)}>
        {review.open}
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="grid w-full min-w-0 gap-4 rounded-2xl border p-4" aria-busy={pending} aria-label={review.open}>
      <p className="text-sm text-muted-foreground">{review.text}</p>
      <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id={`${id}-name`} label={review.name}>
            <input id={`${id}-name`} name="name" required maxLength={80} defaultValue={name} className={inputClass} />
          </Field>
        </div>
        <Field id={`${id}-amount`} label={review.amount}>
          <input id={`${id}-amount`} name="amount" required inputMode="decimal" defaultValue={amount} className={inputClass} />
        </Field>
        <Field id={`${id}-due`} label={review.due}>
          <input id={`${id}-due`} name="dueOn" type="date" defaultValue={dueOn ?? ""} className={inputClass} />
        </Field>
        <fieldset className="grid min-w-0 gap-2 sm:col-span-2">
          <legend className="mb-1.5 font-medium">{review.how}</legend>
          {(["paypal", "outside"] as const).map((choice) => (
            <label key={choice} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-3 has-checked:border-ring">
              <input type="radio" name="how" value={choice} checked={how === choice} onChange={() => setHow(choice)} className="mt-1 size-4 shrink-0 accent-primary" />
              <span className="min-w-0">
                <span className="block font-medium">{review[choice]}</span>
                <span className="block text-sm text-pretty text-muted-foreground">{choice === "paypal" ? review.paypalHint : review.outsideHint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {how === "paypal" ? (
          <div className="sm:col-span-2">
            <Field id={`${id}-receiver`} label={review.email}>
              <input id={`${id}-receiver`} name="receiver" type="email" required maxLength={127} autoComplete="off" className={inputClass} />
            </Field>
          </div>
        ) : null}
      </fieldset>
      {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} className="min-h-11">{pending ? review.submitting : review.submit}</Button>
        <Button type="button" variant="ghost" disabled={pending} className="min-h-11" onClick={() => setOpen(false)}>{review.cancel}</Button>
      </div>
    </form>
  );
}
