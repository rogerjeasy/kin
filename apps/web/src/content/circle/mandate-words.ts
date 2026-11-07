import type { MandateTerms } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

/** What Kin reads back to the parent: the terms in her own order, every figure from the record. */
export function readBack(
  copy: Dictionary["dashboard"]["mandates"],
  format: Formatters,
  terms: MandateTerms,
  words: { readonly item: string; readonly seller: string },
): string {
  return fill(copy.readBack, {
    item: words.item,
    seller: words.seller,
    cadence: copy.cadences[terms.cadence],
    perPurchase: format.money(terms.perPurchaseCents),
    perPeriod: format.money(terms.perPeriodCents),
    from: format.day(terms.validFrom),
    until: format.day(terms.expiresOn),
  });
}

/** The plain-words notice that she is saying yes ahead of time to amounts above what she usually decides herself. */
export function aboveUsualNotice(copy: Dictionary["dashboard"]["mandates"], format: Formatters, terms: MandateTerms, parent: string, aboveUsualCents: number): string {
  return fill(copy.aboveUsual.notice, {
    parent,
    limit: format.money(terms.perPurchaseCents - aboveUsualCents),
    perPurchase: format.money(terms.perPurchaseCents),
    perPeriod: format.money(terms.perPeriodCents),
    until: format.day(terms.expiresOn),
  });
}

/** A day on the circle's calendar moved by whole days. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
