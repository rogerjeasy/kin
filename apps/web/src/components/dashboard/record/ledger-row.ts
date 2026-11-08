import type { PoolFlow } from "@kin/domain";

import type { RecordFilter } from "./record-filters";
import type { RecordEntryItem } from "./record-entry";

export const GROUP_BYS = ["none", "person", "category", "month"] as const;
export type GroupBy = (typeof GROUP_BYS)[number];
export type ActiveGroupBy = Exclude<GroupBy, "none">;

/** The Record (kind filters, an entry panel) or the audit trail (the proof columns, and a debit and credit balance). */
export type LedgerVariant = "record" | "audit";

/** A group an entry falls in: a stable key to group by and the words that name it. */
export type GroupLabel = { readonly key: string; readonly label: string };

/** One ledger entry as the Record, the statement and the audit trail show it. All amounts are integer cents. */
export type LedgerRow = RecordEntryItem & {
  readonly rowKind: "entry";
  /** The calendar day, `YYYY-MM-DD`, which the date column sorts and filters by. */
  readonly isoDay: string;
  /** The settlement period the entry counts toward, `YYYY-MM`. */
  readonly period: string;
  /** The headline amount, above zero. `flow` says which way it moved the pool. */
  readonly cents: number;
  readonly flow: PoolFlow;
  readonly filter: RecordFilter;
  /** What caused the entry: a PayPal event, an approval or a settlement, and that cause's ID. */
  readonly sourceId: string;
  /** The entry this one cancels, if it is a reversal. */
  readonly reverses: string | null;
  /** True when no real PayPal sandbox transaction stands behind it. */
  readonly simulated: boolean;
  readonly person: GroupLabel;
  readonly category: GroupLabel;
  readonly month: GroupLabel;
  /** The ledger lines' totals: always equal, which is what "every entry balances" means. */
  readonly debitCents: number;
  readonly creditCents: number;
};

/** A heading row between groups, with its subtotal drawn from the rows beneath it. */
export type LedgerGroupRow = {
  readonly rowKind: "group";
  readonly id: string;
  readonly groupBy: ActiveGroupBy;
  readonly key: string;
  readonly label: string;
};

/** The pinned row at the foot of the grid, totalling what is shown. */
export type LedgerTotalRow = { readonly rowKind: "total"; readonly id: "total" };

export type LedgerGridRow = LedgerRow | LedgerGroupRow | LedgerTotalRow;

export const isEntry = (row: LedgerGridRow | undefined): row is LedgerRow => row?.rowKind === "entry";
