"use client";

import { SendIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useInvoiceRequest } from "./use-invoice-request";

type Props = { memberId: string; copy: Dictionary["invoicing"] };

/**
 * An organizer asks a member for what the month's settlement collects from
 * them, by PayPal invoice. The browser names the member only: the amount is
 * the money core's, and the server works it out again.
 */
export function InvoiceRequestButton({ memberId, copy }: Props) {
  const { send, pending, error } = useInvoiceRequest();
  return (
    <div className="grid min-w-0 gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} className="h-auto min-h-11 max-w-full justify-self-start whitespace-normal py-2 text-start" onClick={() => void send({ operation: "request", id: crypto.randomUUID(), memberId, purpose: "settlement" })}>
        <SendIcon aria-hidden="true" className="rtl:-scale-x-100" />
        {pending ? copy.requesting : copy.request}
      </Button>
      {error ? <p role="alert" className="text-sm text-pretty text-danger">{copy.errors[error]}</p> : null}
    </div>
  );
}
