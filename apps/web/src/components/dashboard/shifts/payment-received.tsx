import { PartyPopperIcon } from "lucide-react";

import type { ShiftView } from "@/content/circle/shift-views";
import type { ShiftCopy } from "@/content/circle/shift-words";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

type Props = { view: ShiftView; copy: ShiftCopy; format: Formatters };

/** The caregiver's confirmation that a shift they worked has been paid: how much, to which wallet, for which shift. */
export function PaymentReceived({ view, copy, format }: Props) {
  const { shift } = view;
  if (shift.cents === null) return null;
  const wallet = copy.payment.wallets[view.wallet ?? "paypal"];
  return (
    <section aria-labelledby="payment-received-title" className="min-w-0 rounded-2xl border-2 border-positive/40 bg-positive/5 p-5 sm:p-6">
      <div className="flex min-w-0 items-start gap-3">
        <PartyPopperIcon aria-hidden="true" className="mt-1.5 size-7 shrink-0 text-positive" />
        <div className="min-w-0 space-y-1">
          <h2 id="payment-received-title" className="font-serif text-2xl leading-snug text-balance sm:text-3xl">
            {fill(copy.received.title, { amount: format.money(shift.cents), wallet })}
          </h2>
          <p className="text-base text-pretty">{fill(copy.received.text, { shift: shift.title ?? copy.kinds[shift.kind], day: format.weekdayDay(shift.startsAt) })}</p>
          {shift.simulated ? <p className="text-sm font-medium text-muted-foreground">{copy.received.simulated}</p> : null}
        </div>
      </div>
    </section>
  );
}
