import { authorize } from "@kin/auth";
import type { CircleSnapshot } from "@kin/db";
import { TOP_UP_LIMITS, type CircleRole } from "@kin/domain";

import { circleFormatters } from "@/content/circle/format";
import { parentNameOf } from "@/content/circle/members";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { structuredModel } from "@/server/model";
import { PAYPAL_SDK_URL, topUpServices } from "@/server/paypal";
import { speechServices } from "@/server/speech";

import type { QuietCheckout, QuietScreen } from "./quiet-screen";

/**
 * What a quiet-share screen needs, for the viewer's own seat or, in the
 * demo's family layout, for one persona's: their role decides what they may
 * do, and the routes check it again.
 */
export function screenFor(locale: Locale, dictionary: Dictionary, circle: CircleSnapshot, seat: { readonly memberId: string; readonly role: CircleRole } | null): QuietScreen {
  const role = seat?.role ?? circle.viewer.role;
  const may = (action: "quiet_share.raise" | "quiet_share.offer") => authorize({ role, status: "active" }, action).allowed;
  return {
    locale,
    copy: dictionary.dashboard.quietShares,
    speech: speechServices() === null ? null : dictionary.dashboard.speech,
    currency: circle.circle.currency,
    timezone: circle.circle.timezone,
    parent: parentNameOf(circle),
    seat: seat === null || seat.memberId === circle.viewer.memberId ? null : seat.memberId,
    mayRaise: may("quiet_share.raise"),
    mayOffer: may("quiet_share.offer"),
    canRead: structuredModel() !== null,
    checkout: checkoutFor(locale, dictionary, circle),
  };
}

function checkoutFor(locale: Locale, dictionary: Dictionary, circle: CircleSnapshot): QuietCheckout | null {
  const services = topUpServices();
  const limits = TOP_UP_LIMITS[circle.circle.currency];
  if (services === null || limits === undefined || circle.circle.demo) return null;
  const format = circleFormatters(locale, circle);
  return { copy: dictionary.dashboard.topUp, circleName: circle.circle.name, clientId: services.clientId, sdkUrl: PAYPAL_SDK_URL, limits: { min: format.money(limits.minCents), max: format.money(limits.maxCents) } };
}
