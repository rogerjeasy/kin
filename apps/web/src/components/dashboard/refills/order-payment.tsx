import { BadgeCheckIcon, FlaskConicalIcon } from "lucide-react";

import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { OrderPayment } from "@/content/circle/refills";
import { fill } from "@/i18n/template";

type Props = { payment: OrderPayment; copy: { readonly paidSandbox: string; readonly paidSimulated: string; readonly capture: string } };

/**
 * How a bought refill was paid, as its ledger entry says: through PayPal's
 * sandbox, with PayPal's capture ID to look it up by, or simulated. The two
 * never look alike (AGENTS.md section 5, rule 9).
 */
export function OrderPaymentLine({ payment, copy }: Props) {
  if (payment.kind === "simulated") return <StatusPill tone="neutral" icon={FlaskConicalIcon}>{copy.paidSimulated}</StatusPill>;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <StatusPill tone="positive" icon={BadgeCheckIcon}>{copy.paidSandbox}</StatusPill>
      <span className="min-w-0 font-mono text-xs break-all">{fill(copy.capture, { id: payment.captureId })}</span>
    </p>
  );
}
