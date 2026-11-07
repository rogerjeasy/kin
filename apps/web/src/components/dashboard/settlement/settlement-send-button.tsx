"use client";

import { SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useSettlementRequest } from "./use-settlement-request";

type Props = {
  copy: Dictionary["dashboard"]["fairness"]["settlementRun"];
  errors: Dictionary["dashboard"]["fairness"]["errors"];
};

/** An organizer sends the open month's settlement to the family for approval. */
export function SettlementSendButton({ copy, errors }: Props) {
  const { send, pending, error } = useSettlementRequest();
  const [sent, setSent] = useState(false);
  const router = useRouter();
  async function propose() {
    setSent(false);
    const result = await send({ operation: "propose" });
    if (result.ok) {
      setSent(true);
      router.refresh();
    }
  }
  return (
    <div className="space-y-2">
      <Button type="button" disabled={pending} className="min-h-11" onClick={propose}>
        <SendIcon aria-hidden="true" className="rtl:-scale-x-100" />
        {pending ? copy.sending : copy.send}
      </Button>
      {error ? <p role="alert" className="text-sm text-danger">{errors[error]}</p> : null}
      {sent ? <p role="status" className="text-sm text-positive">{copy.sent}</p> : null}
    </div>
  );
}
