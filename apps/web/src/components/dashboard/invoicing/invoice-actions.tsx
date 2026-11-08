"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useInvoiceRequest } from "./use-invoice-request";

type Props = {
  requestId: string;
  /** An organizer may withdraw a request; the member asked may only ask Kin to check it. */
  mayWithdraw: boolean;
  copy: Dictionary["invoicing"];
};

/** Asks Kin to read an open request back from PayPal, or withdraws it. */
export function InvoiceActions({ requestId, mayWithdraw, copy }: Props) {
  const { send, pending, error } = useInvoiceRequest();
  const [checked, setChecked] = useState(false);
  async function check() {
    setChecked(false);
    const reply = await send({ operation: "check", id: requestId });
    setChecked(reply.ok);
  }
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-start" onClick={() => void check()}>
          {pending ? copy.checking : copy.check}
        </Button>
        {mayWithdraw ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-start" onClick={() => void send({ operation: "cancel", id: requestId })}>
            {pending ? copy.cancelling : copy.cancel}
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-sm text-pretty text-danger">{copy.errors[error]}</p> : null}
      {checked ? <p role="status" className="text-sm text-pretty text-muted-foreground">{copy.checked}</p> : null}
    </div>
  );
}
