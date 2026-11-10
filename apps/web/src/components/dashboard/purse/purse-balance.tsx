import { WalletIcon } from "lucide-react";

import { MeterBar } from "@/components/dashboard/ui/meter-bar";
import { RisingFigure } from "@/components/motion/rising-figure";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { PurseScreen } from "@/server/purse";

/** The balance sits on the ink band, which keeps its dark colours in either theme. */
const band = { "data-theme": "dark" } as const;

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
    <section aria-label={screen.isParent ? balance.labelMine : fill(balance.label, { parent: screen.parentName })} {...band} className="aurora relative min-w-0 overflow-clip rounded-3xl border border-band-border p-5 text-foreground shadow-lg sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-lg font-medium text-muted-foreground">{screen.isParent ? balance.labelMine : fill(balance.label, { parent: screen.parentName })}</p>
          <p className="mt-1 font-serif text-5xl tracking-tight tabular-nums break-words sm:text-7xl">
            <RisingFigure value={money(screen.balanceCents)} />
          </p>
          <p className="mt-2 text-lg text-muted-foreground">{fill(balance.ofCeiling, { ceiling: money(purse.ceilingCents) })}</p>
        </div>
        <span aria-hidden="true" className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-band-highlight/15 text-band-highlight ring-1 ring-band-highlight/40 ring-inset motion-safe:animate-glow-pulse">
          <WalletIcon className="size-7" />
        </span>
      </div>
      <MeterBar value={screen.balanceCents} max={purse.ceilingCents} fill="fill-gold" className="mt-6 h-3 drop-shadow-[0_0_8px_rgb(var(--glow-gold)/0.55)]" label={fill(balance.meter, { balance: money(screen.balanceCents), ceiling: money(purse.ceilingCents) })} />
      <ul className="mt-6 grid gap-2 text-base sm:grid-cols-2 [&>li]:rounded-xl [&>li]:border [&>li]:border-band-border [&>li]:bg-secondary/60 [&>li]:px-3.5 [&>li]:py-2.5">
        <li>{fill(balance.weekly, { weekly: money(purse.weeklyCents) })}</li>
        <li>{fill(balance.cap, { cap: money(purse.perPaymentCents) })}</li>
        {screen.availableCents !== null && screen.availableCents !== screen.balanceCents ? <li className="font-medium sm:col-span-2">{fill(balance.available, { amount: money(screen.availableCents) })}</li> : null}
      </ul>
      {purse.simulated ? <p className="mt-4 text-sm text-muted-foreground">{copy.simulated}</p> : null}
    </section>
  );
}
