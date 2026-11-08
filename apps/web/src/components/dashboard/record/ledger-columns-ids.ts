/** The ids of the ledger grid's columns, so the filters, the chooser and the export all name the same ones. */
export const LEDGER_COLUMN = {
  date: "isoDay",
  entry: "text",
  kind: "kind",
  person: "person",
  category: "category",
  source: "source",
  reference: "sourceId",
  id: "id",
  reverses: "reverses",
  amount: "cents",
  effect: "effect",
  debit: "debitCents",
  credit: "creditCents",
} as const;

export type LedgerColumnId = (typeof LEDGER_COLUMN)[keyof typeof LEDGER_COLUMN];
