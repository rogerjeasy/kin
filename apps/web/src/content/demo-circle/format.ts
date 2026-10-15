import { rosesMonth } from "@kin/domain";

import type { Locale } from "@/i18n/locales";
import { formatters, type Formatters } from "@/lib/format";

/** The dashboard's formatters, in the circle's currency. */
export function circleFormatters(locale: Locale): Formatters {
  return formatters(locale, rosesMonth.ledger.currency);
}
