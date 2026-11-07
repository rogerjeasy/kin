"use client";

import { RECEIPT_CATEGORIES } from "@kin/domain";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useSettlementRequest } from "./use-settlement-request";

type Props = {
  copy: Dictionary["dashboard"]["fairness"]["receipts"];
  errors: Dictionary["dashboard"]["fairness"]["errors"];
  categories: Record<string, string>;
  /** The circle's own date, so the day cannot be set in its future. */
  today: string;
};

/**
 * A member files a receipt for money spent from their own pocket. The ID is
 * made once for each receipt, so a retried request files it once.
 */
export function ReceiptForm({ copy, errors, categories, today }: Props) {
  const { send, pending, error } = useSettlementRequest();
  const [filed, setFiled] = useState(false);
  const receiptId = useRef<string>(crypto.randomUUID());
  const router = useRouter();
  async function file(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFiled(false);
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await send({
      operation: "receipt_submit",
      id: receiptId.current,
      category: data.get("category") ?? "",
      amount: data.get("amount") ?? "",
      description: data.get("description") ?? "",
      spentOn: data.get("spentOn") ?? "",
    });
    if (result.ok) {
      receiptId.current = crypto.randomUUID();
      setFiled(true);
      form.reset();
      router.refresh();
    }
  }
  return (
    <form onSubmit={file} className="grid min-w-0 gap-4 rounded-xl border p-4 sm:p-5" aria-busy={pending} aria-labelledby="receipt-form-title">
      <h3 id="receipt-form-title" className="font-semibold">{copy.fileTitle}</h3>
      <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field id="receipt-amount" label={copy.amount} hint={copy.amountHint}>
          <input id="receipt-amount" name="amount" type="text" inputMode="decimal" required autoComplete="off" maxLength={12} aria-describedby="receipt-amount-hint" className={inputClass} />
        </Field>
        <Field id="receipt-category" label={copy.category}>
          <select id="receipt-category" name="category" required defaultValue="pharmacy" className={inputClass}>
            {RECEIPT_CATEGORIES.map((key) => (
              <option key={key} value={key}>{categories[key] ?? key}</option>
            ))}
          </select>
        </Field>
        <Field id="receipt-description" label={copy.description} hint={copy.descriptionHint}>
          <input id="receipt-description" name="description" type="text" required autoComplete="off" maxLength={120} aria-describedby="receipt-description-hint" className={inputClass} />
        </Field>
        <Field id="receipt-date" label={copy.date}>
          <input id="receipt-date" name="spentOn" type="date" required max={today} defaultValue={today} className={inputClass} />
        </Field>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-danger">{errors[error]}</p> : null}
      {filed ? <p role="status" className="text-sm text-positive">{copy.filed}</p> : null}
      <Button type="submit" disabled={pending} className="min-h-11 justify-self-start">{pending ? copy.submitting : copy.submit}</Button>
    </form>
  );
}
