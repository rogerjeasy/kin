import type { CircleSnapshot } from "@kin/db";

import type { Locale } from "@/i18n/locales";
import { formatters, type Formatters } from "@/lib/format";

/** The dashboard's formatters, in the circle's currency and time zone. */
export function circleFormatters(locale: Locale, circle: CircleSnapshot): Formatters {
  return formatters(locale, circle.circle.currency, circle.circle.timezone);
}
