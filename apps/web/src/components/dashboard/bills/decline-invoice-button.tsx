"use client";

import { useBillRequest } from "@/components/dashboard/letters/use-bill-request";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

type Props = { billId: string; label: string; pendingLabel: string; errors: Dictionary["dashboard"]["letters"]["bills"]["errors"] };

/** A member who shares the cost says the family does not owe an agency's invoice. The server decides whether they may. */
export function DeclineInvoiceButton({ billId, label, pendingLabel, errors }: Props) {
  const { send, pending, error } = useBillRequest(errors);
  return (
    <div className="grid min-w-0 gap-2">
      <Button type="button" variant="ghost" className="min-h-11 justify-self-start" disabled={pending} onClick={() => void send({ operation: "decline_invoice", billId })}>
        {pending ? pendingLabel : label}
      </Button>
      {error ? <p role="alert" className="text-sm text-danger">{errors[error]}</p> : null}
    </div>
  );
}
