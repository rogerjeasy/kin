import { ShieldAlertIcon } from "lucide-react";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import type { PursePaymentView } from "@/server/purse";

import { HoldReasons } from "./hold-reasons";
import { CancelPayment } from "./payment-actions";

type Props = {
  payments: readonly PursePaymentView[];
  copy: Dictionary["dashboard"]["purse"];
  format: Formatters;
  parentName: string;
  capCents: number;
  canCancel: boolean;
};

/**
 * The family's alert: a payment she asked for that Kin is holding for a day,
 * or one she stopped because someone was telling her what to do. These are
 * the only payments of hers the family sees without her sharing them.
 */
export function HeldAlerts({ payments, copy, format, parentName, capCents, canCancel }: Props) {
  const flagged = payments.filter((payment) => payment.state === "held" || payment.pressured);
  if (flagged.length === 0) return null;
  const { alerts } = copy;
  return (
    <section aria-labelledby="purse-alerts" className="min-w-0 space-y-3">
      <h2 id="purse-alerts" className="flex items-center gap-2 text-lg font-semibold">
        <ShieldAlertIcon aria-hidden="true" className="size-6 shrink-0 text-highlight" />
        {alerts.title}
      </h2>
      <ul className={flagged.length > 1 ? "grid gap-3 lg:grid-cols-2" : "grid max-w-3xl gap-3"}>
        {flagged.map((payment) => {
          const values = { parent: parentName, payee: payment.payeeName, amount: format.money(payment.cents) };
          return (
            <li key={payment.id} className="min-w-0 space-y-3 rounded-2xl border-2 border-highlight/50 bg-highlight/5 p-4 sm:p-5">
              <p className="text-lg font-semibold text-balance wrap-anywhere">{fill(payment.pressured ? alerts.pressured : alerts.text, values)}</p>
              {payment.words !== "" ? <p className="text-sm text-muted-foreground wrap-anywhere">{fill(alerts.said, { words: payment.words })}</p> : null}
              <HoldReasons reasons={payment.holdReasons} payee={payment.payeeName} cap={format.money(capCents)} copy={copy} className="text-sm" />
              {payment.state === "held" && payment.holdEndsAt !== null ? (
                <p className="text-sm font-medium">{payment.payeeInBook ? fill(copy.payments.heldUntil, { when: format.dateTime(new Date(payment.holdEndsAt)) }) : copy.payments.neverPaid}</p>
              ) : null}
              {payment.state === "held" && canCancel ? <CancelPayment paymentId={payment.id} copy={copy} label={`${payment.payeeName} ${format.money(payment.cents)}`} /> : null}
              {payment.state === "held" && !canCancel ? <p className="text-sm text-muted-foreground">{alerts.readOnly}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
