import type { ReactNode } from "react";

import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";

export type SettlementPayment = { id: string; who: string; amount: string; stateText: string; tone: PillTone };

type Props = {
  title: string;
  description: string;
  progressTitle: string;
  payments: readonly SettlementPayment[];
  /** The button that sends the settlement to the family, when the viewer may and none is out yet. */
  action: ReactNode;
  /** The member's own form for where their payout goes, when they may be paid. */
  receiver: ReactNode;
};

/** Paying out the month: send it for approval, follow each payment, and say where one's own goes. */
export function SettlementRunPanel({ title, description, progressTitle, payments, action, receiver }: Props) {
  return (
    <Panel title={title} description={description}>
      <div className="grid min-w-0 gap-5">
        {action}
        {payments.length === 0 ? null : (
          <section aria-label={progressTitle} className="min-w-0 rounded-xl border p-4">
            <h3 className="text-sm font-semibold">{progressTitle}</h3>
            <ul className="mt-3 divide-y">
              {payments.map((payment) => (
                <li key={payment.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-pretty break-words">{payment.who}</p>
                    <div className="mt-1">
                      <StatusPill tone={payment.tone}>{payment.stateText}</StatusPill>
                    </div>
                  </div>
                  <span className="text-lg font-semibold whitespace-nowrap tabular-nums">{payment.amount}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {receiver}
      </div>
    </Panel>
  );
}
