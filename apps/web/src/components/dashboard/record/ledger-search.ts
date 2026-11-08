import type { LedgerRow } from "./ledger-row.ts";

/**
 * Everything a person might type to find an entry, in one line: what it says,
 * its kind, who or what it is about, where it came from, its amount and day,
 * its ID and its labels. The grid's search box looks through this line.
 */
export function searchTextOf(row: LedgerRow): string {
  return [row.text, row.kind, row.person.label, row.category.label, row.source, row.sourceId, row.id, row.amount, row.day, row.month.label, ...row.tags].join(" ");
}
