"use client";

import { useId, useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useBillRequest } from "./use-bill-request";

type Props = { billId: string; today: string; copy: Dictionary["dashboard"]["letters"]["bills"] };

/**
 * A member says they paid a reviewed bill outside Kin. It is filed as their
 * receipt for the bill's own amount; another member's yes credits it, and the
 * bill is then paid. The ID is drawn once, so a repeated tap files it once.
 */
export function PaidOutsideForm({ billId, today, copy }: Props) {
  const { send, pending, error } = useBillRequest(copy.errors);
  const [receiptId] = useState(() => crypto.randomUUID());
  const id = useId();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await send({ operation: "paid_outside", billId, id: receiptId, spentOn: String(new FormData(event.currentTarget).get("spentOn") ?? "") });
  }
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-wrap items-end gap-3" aria-busy={pending}>
      <fieldset disabled={pending} className="min-w-0 basis-48 grow sm:grow-0">
        <Field id={`${id}-paid`} label={copy.outside.paidOn}>
          <input id={`${id}-paid`} name="spentOn" type="date" required max={today} defaultValue={today} className={inputClass} />
        </Field>
      </fieldset>
      <Button type="submit" disabled={pending} className="min-h-11">{pending ? copy.outside.recording : copy.outside.record}</Button>
      {error ? <p role="alert" className="basis-full text-sm text-danger">{copy.errors[error]}</p> : null}
    </form>
  );
}
