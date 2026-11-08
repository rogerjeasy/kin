import { movementTotals, type MovementTotals } from "@kin/domain";

import { isEntry, type ActiveGroupBy, type GroupBy, type LedgerGridRow, type LedgerGroupRow, type LedgerRow } from "./ledger-row.ts";

/** The heading rows for every group the entries fall in, one each. */
export function groupHeaders(rows: readonly LedgerRow[], by: ActiveGroupBy): LedgerGroupRow[] {
  const seen = new Map<string, LedgerGroupRow>();
  for (const row of rows) {
    const group = row[by];
    if (!seen.has(group.key)) seen.set(group.key, { rowKind: "group", id: headerId(by, group.key), groupBy: by, key: group.key, label: group.label });
  }
  return [...seen.values()];
}

export function headerId(by: ActiveGroupBy, key: string): string {
  return `group:${by}:${key}`;
}

/** Months run newest first, as the Record does; people and categories run alphabetically in the reader's language. */
export function compareGroups(by: ActiveGroupBy, locale: string): (a: LedgerGroupRow, b: LedgerGroupRow) => number {
  if (by === "month") return (a, b) => b.key.localeCompare(a.key);
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  return (a, b) => collator.compare(a.label, b.label);
}

export type Arrangement<T> = {
  /** The nodes in display order: each group's heading, then its entries in the order they came. */
  readonly nodes: T[];
  /** What each group's entries did to the pool, by group key. */
  readonly sections: ReadonlyMap<string, MovementTotals>;
  readonly overall: MovementTotals;
};

/**
 * Lays the entries a grid is showing out in groups with a subtotal each, from
 * integer cents alone. `nodes` arrive already filtered and sorted, with the
 * group headings among them: entries keep their order within a group, a
 * heading with no entry under it is dropped, and with no grouping the order
 * is untouched and only the overall total is worked out.
 */
export function arrangeLedger<T>(nodes: readonly T[], by: GroupBy, read: (node: T) => LedgerGridRow | undefined, compare: (a: LedgerGroupRow, b: LedgerGroupRow) => number): Arrangement<T> {
  const entries = nodes.filter((node) => isEntry(read(node)));
  const overall = movementTotals(entries.flatMap((node) => entryItem(read(node))));
  if (by === "none") return { nodes: entries, sections: new Map(), overall };

  const headings = new Map<string, { node: T; row: LedgerGroupRow }>();
  for (const node of nodes) {
    const row = read(node);
    if (row?.rowKind === "group" && row.groupBy === by) headings.set(row.key, { node, row });
  }
  const members = new Map<string, T[]>();
  for (const node of entries) {
    const row = read(node);
    if (!isEntry(row)) continue;
    const key = row[by].key;
    members.set(key, [...(members.get(key) ?? []), node]);
  }
  const ordered = [...headings.values()].filter(({ row }) => members.has(row.key)).toSorted((a, b) => compare(a.row, b.row));
  const sections = new Map<string, MovementTotals>();
  const arranged: T[] = [];
  for (const { node, row } of ordered) {
    const group = members.get(row.key) ?? [];
    sections.set(row.key, movementTotals(group.flatMap((member) => entryItem(read(member)))));
    arranged.push(node, ...group);
  }
  // An entry is never lost for want of a heading: one without goes last, under no heading.
  for (const [key, group] of members) {
    if (headings.has(key)) continue;
    sections.set(key, movementTotals(group.flatMap((member) => entryItem(read(member)))));
    arranged.push(...group);
  }
  return { nodes: arranged, sections, overall };
}

function entryItem(row: LedgerGridRow | undefined): { flow: LedgerRow["flow"]; cents: number }[] {
  return isEntry(row) ? [{ flow: row.flow, cents: row.cents }] : [];
}
