import { TOP_UP_LIMITS, decimalAmount } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

import { circleFormatters } from "@/content/circle/format";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { may } from "@/server/dashboard-context";
import { PAYPAL_SDK_URL, topUpServices } from "@/server/paypal";

import { TopUpSheet } from "./top-up-sheet";

/** The quick amounts the sheet offers, in cents. */
// The middle one is the default: $100 covers a week of Amara's care in the demo, which waits for money that has arrived.
const PRESETS_CENTS = [5000, 10000, 20000];

/**
 * The "Add money" action, for a member who shares the cost, where this
 * deployment has PayPal. The routes behind it check the role again.
 */
export function TopUpAction({ locale, dictionary, circle, open = false }: { locale: Locale; dictionary: Dictionary; circle: CircleSnapshot; open?: boolean }) {
  const services = topUpServices();
  const { currency } = circle.circle;
  const limits = TOP_UP_LIMITS[currency];
  if (services === null || limits === undefined || !may(circle, "money.contribute")) return null;
  const format = circleFormatters(locale, circle);
  return (
    <TopUpSheet
      locale={locale}
      copy={dictionary.dashboard.topUp}
      circle={circle.circle.name}
      clientId={services.clientId}
      sdkUrl={PAYPAL_SDK_URL}
      currency={currency}
      presets={PRESETS_CENTS.map((cents) => ({ value: decimalAmount({ cents, currency }), label: format.money(cents) }))}
      limits={{ min: format.money(limits.minCents), max: format.money(limits.maxCents) }}
      defaultOpen={open}
    />
  );
}
