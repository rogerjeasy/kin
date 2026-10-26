"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useBillingRequest } from "./use-billing-request";

type Props = { billId: string; copy: Dictionary["dashboard"]["caregiverBilling"] };

/**
 * A reviewer sends a received bill for the family's approval, or declines it.
 * Sending raises a proposal on the server from the bill's own evidence; it
 * approves nothing. Declining asks once more, in place, before it closes the bill.
 */
export function ReviewActions({ billId, copy }: Props) {
  const { send, pending, error } = useBillingRequest(copy.errors);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  async function act(operation: "send" | "decline") {
    const result = await send({ operation, billId });
    if (result.ok) router.refresh();
  }
  return (
    <div className="mt-4 min-w-0 space-y-3 border-t pt-4" aria-busy={pending}>
      <p className="text-sm text-muted-foreground">{copy.reviewText}</p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={copy.declineConfirm}>
          <p className="basis-full text-sm font-medium">{copy.declineConfirm}</p>
          <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => act("decline")}>{copy.declineYes}</Button>
          <Button type="button" variant="ghost" disabled={pending} className="min-h-11" onClick={() => setConfirming(false)}>{copy.declineKeep}</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} className="min-h-11" onClick={() => act("send")}>{pending ? copy.sending : copy.sendForApproval}</Button>
          <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => setConfirming(true)}>{copy.decline}</Button>
        </div>
      )}
      {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
    </div>
  );
}
