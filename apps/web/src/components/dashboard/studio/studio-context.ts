import type { AgWidgetDataFormat, AgWidgetFieldReference } from "ag-studio";

import type { Formatters } from "@/lib/format";

import type { StudioCopy } from "./studio-sources";

/** What every widget in the studio is handed through AG Studio's `context`: Kin's words and Kin's one set of formatters. */
export type StudioContext = { readonly copy: StudioCopy; readonly format: Formatters };

/** The fairness gap widget's state: who, what they gave, their agreed share, and what settling up would move. */
export type FairnessGapState = {
  type: "kin-fairness-gap";
  dataMapping: { member: AgWidgetFieldReference[]; given: AgWidgetFieldReference[]; agreed: AgWidgetFieldReference[]; gap: AgWidgetFieldReference[] };
  format?: AgWidgetDataFormat<unknown>;
};

/** The PayPal-verified tile's state: PayPal's ID for each entry, and its amount. */
export type PaypalVerifiedState = {
  type: "kin-paypal-verified";
  dataMapping: { paypalId: AgWidgetFieldReference[]; amount: AgWidgetFieldReference[] };
  format?: AgWidgetDataFormat<unknown>;
};

/** A value AG Studio returned for a money field: whole cents, or nothing. */
export function centsOf(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
