import { ShieldAlertIcon, WalletIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import type { PurseScreen } from "@/server/purse";

type Props = { screen: PurseScreen & { purse: NonNullable<PurseScreen["purse"]> }; copy: Dictionary["dashboard"]["purse"]["card"]; format: Formatters; href: string };

/**
 * The overview's way into the Purse. For her: what she has to give, and the
 * way to send a gift. For the family: the balance and the month's total, and
 * any payment Kin is holding, never a payment of hers.
 */
export function PurseCard({ screen, copy, format, href }: Props) {
  const held = screen.payments.filter((payment) => payment.state === "held").length;
  const values = { parent: screen.parentName, balance: format.money(screen.balanceCents), ceiling: format.money(screen.purse.ceilingCents), month: format.money(screen.month.cents) };
  return (
    <Panel
      title={screen.isParent ? copy.titleMine : fill(copy.title, values)}
      description={fill(screen.isParent ? copy.textMine : copy.text, values)}
      link={{ href, label: screen.isParent ? copy.linkMine : copy.link }}
      aside={<WalletIcon aria-hidden="true" className="size-6 shrink-0 text-primary" />}
    >
      {held > 0 && !screen.isParent ? (
        <p className="flex items-start gap-2 rounded-xl bg-highlight/10 p-3 font-semibold text-balance">
          <ShieldAlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-highlight" />
          {fill(held === 1 ? copy.heldOne : copy.heldMany, { count: format.count(held), parent: screen.parentName })}
        </p>
      ) : (
        <p className="sr-only">{screen.isParent ? copy.titleMine : fill(copy.title, values)}</p>
      )}
    </Panel>
  );
}
