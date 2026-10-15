import type { EntryKind } from "@kin/domain";

export const RECORD_FILTERS = ["all", "in", "bills", "purchases", "ownPocket", "care"] as const;

export type RecordFilter = (typeof RECORD_FILTERS)[number];

/** The filter each kind of entry falls under. A kind under "all" shows only there. */
export const FILTER_OF: Record<EntryKind, RecordFilter> = {
  contribution: "in",
  settlement_collection: "in",
  bill_approved: "bills",
  payout_confirmed: "bills",
  settlement_payout: "all",
  purchase_captured: "purchases",
  out_of_pocket: "ownPocket",
  care_credit: "care",
};
