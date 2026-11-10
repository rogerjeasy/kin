"use client";

import { EyeIcon, EyeOffIcon, OctagonXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { PurseError } from "./purse-error";
import { usePurseRequest } from "./use-purse-request";

type Copy = Dictionary["dashboard"]["purse"];

/** Her consent for the family to see one payment, given or taken back. Only she is offered it; the database refuses anyone else. */
export function ShareToggle({ paymentId, shared, copy, label }: { paymentId: string; shared: boolean; copy: Copy; label: string }) {
  const { send, pending, error } = usePurseRequest();
  return (
    <div className="min-w-0 space-y-1">
      <Button type="button" variant="outline" size="sm" aria-pressed={shared} aria-label={`${shared ? copy.payments.unshare : copy.payments.share}: ${label}`} disabled={pending} onClick={() => void send({ operation: "share", paymentId, share: !shared })} className="h-auto max-w-full whitespace-normal text-start">
        {shared ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
        {shared ? copy.payments.unshare : copy.payments.share}
      </Button>
      <PurseError copy={copy.errors} error={error} money={() => ""} />
    </div>
  );
}

/** Stops a held payment during its cooling-off: her, or a member who answers for the family. */
export function CancelPayment({ paymentId, copy, label }: { paymentId: string; copy: Copy; label: string }) {
  const { send, pending, error } = usePurseRequest();
  return (
    <div className="min-w-0 space-y-1">
      <Button type="button" variant="outline" aria-label={`${copy.alerts.cancel}: ${label}`} disabled={pending} onClick={() => void send({ operation: "cancel", paymentId })} className="h-auto max-w-full border-danger/40 whitespace-normal text-danger hover:bg-danger/5">
        <OctagonXIcon aria-hidden="true" />
        {copy.alerts.cancel}
      </Button>
      <PurseError copy={copy.errors} error={error} money={() => ""} />
    </div>
  );
}
