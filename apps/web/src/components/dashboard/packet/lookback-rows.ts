import type { OutflowRow } from "@kin/domain";

import type { CircleNames } from "@/content/circle/names";
import type { Dictionary } from "@/i18n/dictionary";
import type { Formatters } from "@/lib/format";

/** One payment out of the care account, as the screen shows it: every field already in the reader's words. */
export type LookbackScreenRow = {
  readonly id: string;
  readonly day: string;
  readonly to: string;
  readonly kind: string;
  readonly amount: string;
  readonly status: OutflowRow["status"];
  readonly statusLabel: string;
  /** Why it lacks documentation and what else a reader should know, one sentence each. */
  readonly why: readonly string[];
};

/** The look-back's rows in the reader's words, newest first. */
export function lookbackScreenRows(rows: readonly OutflowRow[], copy: Dictionary["dashboard"]["packet"]["lookback"], names: CircleNames, format: Formatters): LookbackScreenRow[] {
  return rows
    .toSorted((a, b) => b.occurredOn.localeCompare(a.occurredOn))
    .map((row) => ({
      id: row.entryId,
      day: format.day(row.occurredOn),
      to: names.subject(row.subject),
      kind: copy.classes[row.class],
      amount: format.money(row.cents),
      status: row.status,
      statusLabel: copy.status[row.status],
      why: [...row.reasons.map((reason) => copy.reasons[reason]), ...row.marks.map((mark) => copy.marks[mark])],
    }));
}
