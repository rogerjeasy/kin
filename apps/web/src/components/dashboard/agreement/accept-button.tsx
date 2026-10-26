"use client";

import { CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { useAgreementRequest, type AgreementErrors } from "./use-agreement-request";

type Props = { agreementId: string; label: string; pendingLabel: string; errors: AgreementErrors };

/** The viewer accepts the newest version, in their own seat. */
export function AcceptButton({ agreementId, label, pendingLabel, errors }: Props) {
  const { send, pending, error } = useAgreementRequest();
  const router = useRouter();
  async function accept() {
    const result = await send({ operation: "accept", agreementId });
    if (result.ok) router.refresh();
  }
  return (
    <div className="space-y-2">
      <Button type="button" disabled={pending} className="min-h-11" onClick={accept}>
        <CheckIcon aria-hidden="true" />
        {pending ? pendingLabel : label}
      </Button>
      {error ? <p role="alert" className="text-sm text-danger">{errors[error]}</p> : null}
    </div>
  );
}
