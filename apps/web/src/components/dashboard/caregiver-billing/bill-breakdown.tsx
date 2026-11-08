import type { CaregiverBill } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";

type Props = { bill: CaregiverBill; locale: Locale; copy: Dictionary["dashboard"]["caregiverBilling"] };

/** Renders the server's line amounts; the browser never calculates a bill. */
export function BillBreakdown({ bill, locale, copy }: Props) {
  const format = formatters(locale, bill.details.currency);
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm text-muted-foreground">{fill(copy.rateLine, { rate: format.money(bill.details.rateCentsPerHour) })}</p>
      <ul className="divide-y">
        {bill.lines.map((line) => (
          <li key={line.date} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0"><time dateTime={line.date}>{format.longCalendarDay(line.date)}</time><p className="text-sm text-muted-foreground">{fill(copy.duration, { minutes: format.count(line.minutes) })}</p></div>
            <span className="font-medium tabular-nums wrap-anywhere">{format.money(line.cents)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-between gap-2 border-t pt-3 font-semibold"><span>{copy.total}</span><span className="tabular-nums wrap-anywhere">{format.money(bill.cents)}</span></div>
    </div>
  );
}
