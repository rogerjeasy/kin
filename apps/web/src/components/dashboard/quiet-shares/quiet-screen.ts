import type { OwnOfferRecord } from "@kin/db";

import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

export type QuietCopy = Dictionary["dashboard"]["quietShares"];

/** PayPal checkout for a real circle's part: the top-up sheet, opened at the part's amount. `null` where this deployment has no PayPal. */
export type QuietCheckout = {
  readonly copy: Dictionary["dashboard"]["topUp"];
  readonly circleName: string;
  readonly clientId: string;
  readonly sdkUrl: string;
  readonly limits: { readonly min: string; readonly max: string };
};

/** What every quiet-share screen part needs from the page: the language, the circle's money and clock, and who is acting. */
export type QuietScreen = {
  readonly locale: Locale;
  readonly copy: QuietCopy;
  readonly speech: Dictionary["dashboard"]["speech"] | null;
  readonly currency: string;
  readonly timezone: string;
  /** The parent's name, for the examples a person may say. */
  readonly parent: string;
  /** The seat a phone of the demo's family layout acts in; `null` for the viewer's own. */
  readonly seat: string | null;
  /** Whether this seat may raise, spread and withdraw asks. */
  readonly mayRaise: boolean;
  /** Whether this seat shares the cost and so answers. */
  readonly mayOffer: boolean;
  /** Whether Kin can read words here: a model is configured. */
  readonly canRead: boolean;
  readonly checkout: QuietCheckout | null;
};

/** A person's own offer in words: "$60 now, $150 a month from December 2026, 2 drives or visits". */
export function offerSummary(offer: Omit<OwnOfferRecord, "seals" | "sealedAt">, copy: QuietCopy["offer"]["summary"], format: Formatters): string {
  const parts = [
    offer.monthlyCents > 0 ? fill(copy.monthly, { amount: format.money(offer.monthlyCents) }) : copy.nothing,
    offer.stepUp === null ? null : fill(copy.stepUp, { amount: format.money(offer.stepUp.cents), month: format.month(offer.stepUp.fromMonth) }),
    offer.earliestMonth === null ? null : fill(copy.earliest, { month: format.month(offer.earliestMonth) }),
    offer.careTrips > 0 ? fill(copy.trips, { count: format.count(offer.careTrips) }) : null,
    offer.careMinutes > 0 ? fill(copy.hours, { hours: format.count(Math.round(offer.careMinutes / 6) / 10) }) : null,
  ];
  return format.allOf(parts.filter((part): part is string => part !== null));
}

/** The words for the cost and how often it is paid. */
export function costWords(ask: { readonly kind: "one_off" | "monthly"; readonly costCents: number; readonly months: number }, copy: QuietCopy["kinds"], format: Formatters): string {
  const cost = format.money(ask.costCents);
  if (ask.kind === "monthly") return fill(copy.monthly, { cost });
  return ask.months > 1 ? fill(copy.spread, { cost, months: format.count(ask.months) }) : fill(copy.one_off, { cost });
}
