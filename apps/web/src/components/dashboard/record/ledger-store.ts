import { useSyncExternalStore } from "react";
import { movementTotals, type MovementTotals } from "@kin/domain";

import type { LedgerGridRow, LedgerRow } from "./ledger-row.ts";

/** What the grid is showing, as the rest of the screen needs it: the rows in order, with each group's and the whole view's totals. */
export type LedgerSnapshot = {
  readonly rows: readonly LedgerGridRow[];
  readonly sections: ReadonlyMap<string, MovementTotals>;
  readonly overall: MovementTotals;
};

export type LedgerStore = {
  readonly get: () => LedgerSnapshot;
  readonly set: (next: LedgerSnapshot) => void;
  readonly subscribe: (listener: () => void) => () => void;
};

/** The snapshot of rows shown as they stand, before any filter or grouping. */
export function plainSnapshot(rows: readonly LedgerRow[]): LedgerSnapshot {
  return { rows, sections: new Map(), overall: movementTotals(rows) };
}

function sameSnapshot(a: LedgerSnapshot, b: LedgerSnapshot): boolean {
  if (a.rows.length !== b.rows.length || a.rows.some((row, index) => row !== b.rows[index])) return false;
  if (!sameTotals(a.overall, b.overall) || a.sections.size !== b.sections.size) return false;
  return [...b.sections].every(([key, totals]) => {
    const before = a.sections.get(key);
    return before !== undefined && sameTotals(before, totals);
  });
}

const sameTotals = (a: MovementTotals, b: MovementTotals) => a.count === b.count && a.inCents === b.inCents && a.outCents === b.outCents;

/**
 * A small store the grid writes to after each filter, sort and grouping and
 * that the totals rows, the phone's cards and the live regions read from, so
 * they always show what the grid shows.
 */
export function createLedgerStore(initial: LedgerSnapshot): LedgerStore {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => snapshot,
    set: (next) => {
      if (sameSnapshot(snapshot, next)) return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export function useLedgerSnapshot(store: LedgerStore): LedgerSnapshot {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
