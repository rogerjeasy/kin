import { WalletIcon } from "lucide-react";

import { MeterBar } from "@/components/dashboard/ui/meter-bar";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { PurseScreen } from "@/server/purse";

type Props = { screen: PurseScreen & { purse: NonNullable<PurseScreen["purse"]> }; copy: Dictionary["dashboard"]["purse"]; money: (cents: number) => string };

/**
 * The Purse at a glance, in big type: what is in it, the most it ever holds,
 * what the family adds each week and the most one payment may be. For her, it
 * also says what she can still spend.
 */
export function PurseBalance({ screen, copy, money }: Props) {
  const { purse } = screen;
  const { balance } = copy;
  return (
    <section aria-label={screen.isParent ? balance.labelMine : fill(balance.label, { parent: screen.parentName })} className="min-w-0 rounded-2xl border bg-card p-5 shadow-xs sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-lg font-medium text-muted-foreground">{screen.isParent ? balance.labelMine : fill(balance.label, { parent: screen.parentName })}</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums break-words sm:text-6xl">{money(screen.balanceCents)}</p>
          <p className="mt-2 text-lg text-muted-foreground">{fill(balance.ofCeiling, { ceiling: money(purse.ceilingCents) })}</p>
        </div>
        <span aria-hidden="true" className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <WalletIcon className="size-7" />
        </span>
      </div>
      <MeterBar value={screen.balanceCents} max={purse.ceilingCents} fill="fill-primary" className="mt-5 h-3" label={fill(balance.meter, { balance: money(screen.balanceCents), ceiling: money(purse.ceilingCents) })} />
      <ul className="mt-5 grid gap-2 text-base sm:grid-cols-2">
        <li>{fill(balance.weekly, { weekly: money(purse.weeklyCents) })}</li>
        <li>{fill(balance.cap, { cap: money(purse.perPaymentCents) })}</li>
        {screen.availableCents !== null && screen.availableCents !== screen.balanceCents ? <li className="font-medium sm:col-span-2">{fill(balance.available, { amount: money(screen.availableCents) })}</li> : null}
      </ul>
      {purse.simulated ? <p className="mt-4 text-sm text-muted-foreground">{copy.simulated}</p> : null}
    </section>
  );
}
