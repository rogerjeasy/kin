import type { InvoiceRequestRecord } from "@kin/db";
import type { InvoiceRequestState } from "@kin/domain";
import { CheckCircle2Icon, CircleSlashIcon, ClockIcon, ExternalLinkIcon, SendIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";

import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import { buttonVariants } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import { cn } from "@/lib/utils";

import { InvoiceActions } from "./invoice-actions";

const LOOK: Record<InvoiceRequestState, { tone: PillTone; icon: LucideIcon }> = {
  requested: { tone: "waiting", icon: ClockIcon },
  sent: { tone: "waiting", icon: SendIcon },
  paid: { tone: "positive", icon: CheckCircle2Icon },
  cancelled: { tone: "neutral", icon: CircleSlashIcon },
  failed: { tone: "danger", icon: TriangleAlertIcon },
};

type Props = {
  request: InvoiceRequestRecord;
  /** The member asked to pay, by name. */
  name: string;
  /** Who is looking: an organizer may withdraw it, the member asked may ask Kin to check it. */
  viewer: "organizer" | "payer" | "family";
  copy: Dictionary["invoicing"];
};

/**
 * Where one request for money by PayPal invoice stands, from the record: its
 * state, PayPal's invoice number and ID (or the Simulated label when no
 * invoice stands behind it), where PayPal emailed it, and PayPal's own page.
 */
export function InvoiceStatus({ request, name, viewer, copy }: Props) {
  // A simulated request was never sent by PayPal, so it reads as requested until its stand-in pays it.
  const shown: InvoiceRequestState = request.simulated && request.state === "sent" ? "requested" : request.state;
  const look = LOOK[shown];
  const open = request.state === "requested" || request.state === "sent";
  return (
    <div className="grid min-w-0 gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={look.tone} icon={look.icon}>{copy.states[shown]}</StatusPill>
        {request.simulated ? <StatusPill tone="neutral">{copy.simulated}</StatusPill> : null}
      </div>
      {request.paypalInvoiceId === null ? null : (
        <p className="min-w-0 break-all text-muted-foreground">
          {request.invoiceNumber === null ? null : <span className="font-medium text-foreground">{fill(copy.number, { number: request.invoiceNumber })}</span>}
          {request.invoiceNumber === null ? null : " · "}
          <span className="font-mono text-xs">{fill(copy.paypalId, { id: request.paypalInvoiceId })}</span>
        </p>
      )}
      {request.recipient === null ? null : <p className="min-w-0 break-all text-muted-foreground">{fill(copy.sentTo, { email: request.recipient })}</p>}
      {request.simulated ? <p className="text-pretty text-muted-foreground">{copy.simulatedNote}</p> : null}
      {!request.simulated && request.recipient !== null && request.recipient.endsWith("@personal.example.com") ? (
        <p className="text-pretty text-muted-foreground">{fill(copy.sandboxNote, { name })}</p>
      ) : null}
      {request.payerUrl !== null && request.state === "sent" ? (
        <a href={request.payerUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ size: "sm", variant: "outline" }), "justify-self-start")}>
          <ExternalLinkIcon aria-hidden="true" />
          {copy.open}
        </a>
      ) : null}
      {open && viewer !== "family" ? <InvoiceActions requestId={request.id} mayWithdraw={viewer === "organizer"} copy={copy} /> : null}
    </div>
  );
}
