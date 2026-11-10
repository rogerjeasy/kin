import { CheckCircle2Icon, CircleDashedIcon, EyeIcon, HourglassIcon, LockIcon, OctagonXIcon, SendIcon, type LucideIcon } from "lucide-react";
import type { PursePaymentState } from "@kin/domain";

import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import type { PursePaymentView } from "@/server/purse";

import { CancelPayment, ShareToggle } from "./payment-actions";

type Props = {
  payment: PursePaymentView;
  copy: Dictionary["dashboard"]["purse"];
  format: Formatters;
  parentName: string;
  /** She is looking: she may share it. */
  isParent: boolean;
  /** Someone who may stop a held payment is looking. */
  canCancel: boolean;
};

const STATE_LOOK: Readonly<Record<PursePaymentState, { readonly tone: PillTone; readonly icon: LucideIcon }>> = {
  proposed: { tone: "neutral", icon: CircleDashedIcon },
  held: { tone: "waiting", icon: HourglassIcon },
  approved: { tone: "waiting", icon: SendIcon },
  executing: { tone: "waiting", icon: SendIcon },
  unknown: { tone: "waiting", icon: HourglassIcon },
  paid: { tone: "positive", icon: CheckCircle2Icon },
  failed: { tone: "danger", icon: OctagonXIcon },
  declined: { tone: "neutral", icon: OctagonXIcon },
  expired: { tone: "neutral", icon: OctagonXIcon },
  cancelled: { tone: "danger", icon: OctagonXIcon },
};

/** One payment from the Purse: who, how much, its state in words, and what may be done about it. */
export function PaymentRow({ payment, copy, format, parentName, isParent, canCancel }: Props) {
  const look = STATE_LOOK[payment.state];
  const { payments } = copy;
  const label = `${payment.payeeName} ${format.money(payment.cents)}`;
  const flagged = payment.heldAt !== null;
  const notes = [
    payment.state === "held" && payment.holdEndsAt !== null ? (payment.payeeInBook ? fill(payments.heldUntil, { when: format.dateTime(new Date(payment.holdEndsAt)) }) : payments.neverPaid) : null,
    payment.pressured ? fill(payments.pressuredNote, { parent: parentName }) : payment.state === "cancelled" && payment.cancelledByName !== null ? fill(payments.stoppedBy, { name: payment.cancelledByName }) : null,
  ].filter((note): note is string => note !== null);
  return (
    <li id={`purse-payment-${payment.id}`} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-lg font-semibold wrap-anywhere">
          {payment.payeeName}
          {payment.memo ? <span className="font-normal text-muted-foreground"> · {payment.memo}</span> : null}
        </p>
        <p className="text-sm text-muted-foreground">{format.dateTime(new Date(payment.paidAt ?? payment.createdAt))}</p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={look.tone} icon={look.icon}>
            {copy.states[payment.state]}
          </StatusPill>
          {payment.simulated ? <StatusPill tone="neutral">{payments.simulated}</StatusPill> : null}
          {isParent ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              {payment.shared || flagged ? <EyeIcon aria-hidden="true" className="size-3.5" /> : <LockIcon aria-hidden="true" className="size-3.5" />}
              {flagged ? payments.flagged : payment.shared ? payments.shared : payments.sealed}
            </span>
          ) : null}
        </div>
        {notes.map((note) => (
          <p key={note} className="text-sm wrap-anywhere">
            {note}
          </p>
        ))}
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        <p className="text-xl font-semibold tabular-nums">{format.money(payment.cents)}</p>
        {isParent && !flagged && payment.state !== "proposed" ? <ShareToggle paymentId={payment.id} shared={payment.shared} copy={copy} label={label} /> : null}
        {canCancel && payment.state === "held" ? <CancelPayment paymentId={payment.id} copy={copy} label={label} /> : null}
      </div>
    </li>
  );
}
