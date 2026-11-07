"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { useSettlementRequest, type SettlementErrors } from "./use-settlement-request";

type Props = { receiptId: string; approve: string; decline: string; working: string; errors: SettlementErrors };

/** Another member approves or declines a receipt. The server refuses a decision on one's own. */
export function ReceiptActions({ receiptId, approve, decline, working, errors }: Props) {
  const { send, pending, error } = useSettlementRequest();
  const router = useRouter();
  async function decide(yes: boolean) {
    const result = await send({ operation: "receipt_decide", receiptId, approve: yes });
    if (result.ok) router.refresh();
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} className="min-h-11" onClick={() => decide(true)}>
          <CheckIcon aria-hidden="true" />
          {pending ? working : approve}
        </Button>
        <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => decide(false)}>
          <XIcon aria-hidden="true" />
          {decline}
        </Button>
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{errors[error]}</p> : null}
    </div>
  );
}
