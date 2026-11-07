import type { CircleSnapshot } from "@kin/db";
import { CurrencyConversionError, SIMULATED_RATES, convertMoney } from "@kin/domain";

import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";

/**
 * A member's agreed share in the currency they think in, next to the pool's.
 * Empty when the member gives in the circle's currency, or when no rate is
 * known for theirs. The rates are the demo's fixed table and the line says so
 * (architecture.md section 23: sandbox multi-currency is unverified).
 */
export function ownCurrencyLines(
  circle: CircleSnapshot,
  locale: Locale,
  member: { readonly memberId: string; readonly targetCents: number },
  label: string,
): { label: string; value: string }[] {
  const own = circle.members.find((each) => each.id === member.memberId)?.currency ?? null;
  const pool = circle.circle.currency;
  if (own === null || own === pool) return [];
  try {
    const { result } = convertMoney({ cents: member.targetCents, currency: pool }, own, SIMULATED_RATES);
    return [{ label: fill(label, { currency: own }), value: formatters(locale, own).money(result.cents) }];
  } catch (error) {
    if (error instanceof CurrencyConversionError) return [];
    throw error;
  }
}
