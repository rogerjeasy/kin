import { formatMoney } from "@kin/domain";

import { isolatedFor } from "../lib/format";
import { numberLocaleOf, type Locale } from "../i18n/locales";
import { exampleFamily } from "./example-family";

export type ExampleAmounts = Record<
  "limit" | "bill" | "gasBill" | "caregiverPay" | "refill" | "elena" | "ana",
  string
>;

/** The example family's figures, formatted for a reader of the given locale. */
export function exampleAmounts(locale: Locale): ExampleAmounts {
  const numberLocale = numberLocaleOf(locale);
  const isolated = isolatedFor(locale);
  return {
    limit: isolated(formatMoney(exampleFamily.purchaseLimit, numberLocale)),
    bill: isolated(formatMoney(exampleFamily.electricityBill, numberLocale)),
    gasBill: isolated(formatMoney(exampleFamily.gasBill, numberLocale)),
    caregiverPay: isolated(formatMoney(exampleFamily.caregiverPay, numberLocale)),
    refill: isolated(formatMoney(exampleFamily.refill, numberLocale)),
    elena: isolated(formatMoney(exampleFamily.settlement.elena, numberLocale)),
    ana: isolated(formatMoney(exampleFamily.settlement.ana, numberLocale)),
  };
}
