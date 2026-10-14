import { formatMoney } from "@kin/domain";

import { numberLocaleOf, type Locale } from "../i18n/locales";
import { exampleFamily } from "./example-family";

export type ExampleAmounts = Record<
  "limit" | "bill" | "gasBill" | "caregiverPay" | "refill" | "elena" | "ana",
  string
>;

/** The example family's figures, formatted for a reader of the given locale. */
export function exampleAmounts(locale: Locale): ExampleAmounts {
  const numberLocale = numberLocaleOf(locale);
  return {
    limit: formatMoney(exampleFamily.purchaseLimit, numberLocale),
    bill: formatMoney(exampleFamily.electricityBill, numberLocale),
    gasBill: formatMoney(exampleFamily.gasBill, numberLocale),
    caregiverPay: formatMoney(exampleFamily.caregiverPay, numberLocale),
    refill: formatMoney(exampleFamily.refill, numberLocale),
    elena: formatMoney(exampleFamily.settlement.elena, numberLocale),
    ana: formatMoney(exampleFamily.settlement.ana, numberLocale),
  };
}
