import type { OwnPartRecord } from "@kin/db";
import { addMonths } from "@kin/domain";
import { EyeOffIcon } from "lucide-react";

import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import type { QuietCopy } from "./quiet-screen";

type Props = { copy: QuietCopy; part: OwnPartRecord; costCents: number; startMonth: string; format: Formatters };

/**
 * The person's own part and the family's total, and nothing of anyone else's:
 * their amount, month by month when the cost is spread, the help they offered
 * and what it counts for, and, when their part stopped at their own limit,
 * the one line nobody else sees.
 */
export function PartFigures({ copy, part, costCents, startMonth, format }: Props) {
  const words = copy.part;
  const asksNothing = part.cents === 0 && part.careTrips === 0 && part.careMinutes === 0;
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm font-medium text-muted-foreground">{words.title}</p>
      {asksNothing ? (
        <p className="text-lg">{words.nothing}</p>
      ) : (
        <div className="min-w-0">
          <p className="font-serif text-title leading-tight wrap-anywhere">{format.money(part.cents)}</p>
          {part.careTrips > 0 ? <p className="text-lg font-medium">{fill(words.care, { count: format.count(part.careTrips) })}</p> : null}
          <p className="mt-1 text-sm text-muted-foreground">{fill(words.of, { total: format.money(costCents) })}</p>
        </div>
      )}
      {part.perMonth.length > 1 ? (
        <ul className="min-w-0 space-y-1 text-sm">
          {part.perMonth.map((cents, index) => (
            <li key={index}>{fill(words.months, { month: format.month(addMonths(startMonth, index)), amount: format.money(cents) })}</li>
          ))}
        </ul>
      ) : null}
      {part.payLaterCents > 0 ? <p className="text-sm">{fill(words.payLater, { amount: format.money(part.payLaterCents) })}</p> : null}
      {part.careValueCents > 0 ? <p className="text-sm text-muted-foreground">{fill(words.careValue, { value: format.money(part.careValueCents) })}</p> : null}
      {asksNothing ? null : <p className="text-sm text-muted-foreground">{fill(words.share, { share: format.money(part.shareCents) })}</p>}
      {part.atLimit ? (
        <div className="flex min-w-0 items-start gap-3 rounded-xl bg-positive/10 p-3 text-positive">
          <EyeOffIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">{words.private}</p>
            <p className="text-sm text-foreground">{words.privateText}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
