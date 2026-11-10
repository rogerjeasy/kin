import { CalendarClockIcon, GaugeIcon, LockIcon, WalletIcon } from "lucide-react";

import { StatTile } from "@/components/dashboard/ui/stat-tile";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import type { PurseScreen } from "@/server/purse";

type Props = { screen: PurseScreen & { purse: NonNullable<PurseScreen["purse"]> }; copy: Dictionary["dashboard"]["purse"]["summary"]; format: Formatters };

/** The Purse as the family sees it: what is in it, the month's total out of it, and its rules. Never a payment of hers. */
export function PurseSummary({ screen, copy, format }: Props) {
  const { purse, month } = screen;
  const monthNote = month.count === 0 ? copy.month.none : fill(month.count === 1 ? copy.month.one : copy.month.many, { count: format.count(month.count) });
  return (
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label={copy.balance.label} value={format.money(screen.balanceCents)} note={fill(copy.balance.note, { ceiling: format.money(purse.ceilingCents) })} icon={WalletIcon} />
      <StatTile label={fill(copy.month.label, { month: format.month(month.period) })} value={format.money(month.cents)} note={monthNote} icon={LockIcon} />
      <StatTile label={copy.weekly.label} value={format.money(purse.weeklyCents)} note={copy.weekly.note} icon={CalendarClockIcon} />
      <StatTile label={copy.cap.label} value={format.money(purse.perPaymentCents)} note={copy.cap.note} icon={GaugeIcon} />
    </dl>
  );
}
