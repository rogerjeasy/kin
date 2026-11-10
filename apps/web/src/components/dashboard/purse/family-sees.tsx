import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import type { PurseScreen } from "@/server/purse";

type Props = { screen: PurseScreen & { purse: NonNullable<PurseScreen["purse"]> }; copy: Dictionary["dashboard"]["purse"]["familySees"]; format: Formatters };

const LINES = 6;

/**
 * Exactly what the rest of her family can see about her Purse, read from the
 * same rows their screens read: the limit and the balance, the month's total,
 * each payment's amount and day as the family record keeps it, and the
 * payments she shared or Kin held. Nothing else reaches them.
 */
export function FamilySees({ screen, copy, format }: Props) {
  const shared = screen.payments.filter((payment) => payment.shared && payment.heldAt === null).length;
  const flagged = screen.payments.filter((payment) => payment.heldAt !== null).length;
  const month = screen.month.count === 0 ? copy.monthNone : fill(screen.month.count === 1 ? copy.monthOne : copy.monthMany, { amount: format.money(screen.month.cents), count: format.count(screen.month.count), month: format.month(screen.month.period) });
  const lines = screen.ledgerLines.slice(0, LINES);
  return (
    <Panel title={copy.title} description={copy.text} aside={<EyeIcon aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" />}>
      <ul className="space-y-3 text-base">
        <li>{fill(copy.limit, { ceiling: format.money(screen.purse.ceilingCents), balance: format.money(screen.balanceCents) })}</li>
        <li>{month}</li>
        <li>
          <p>{copy.lines}</p>
          {lines.length === 0 ? null : (
            <ul className="mt-2 space-y-1 rounded-xl bg-muted/50 p-3 font-mono text-sm">
              {lines.map((line) => (
                <li key={line.id} className="wrap-anywhere">
                  {fill(line.kind === "purse_paid" ? copy.line : copy.funded, { day: format.day(line.day), amount: format.money(line.cents) })}
                </li>
              ))}
            </ul>
          )}
        </li>
        <li>{fill(copy.shared, { count: format.count(shared) })}</li>
        <li>{fill(copy.held, { count: format.count(flagged) })}</li>
        <li className="flex items-start gap-2 font-semibold">
          <EyeOffIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {copy.never}
        </li>
      </ul>
    </Panel>
  );
}
