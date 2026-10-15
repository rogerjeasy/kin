import { describeAccount, restoreEntry, type AccountCode, type LedgerEntry } from "@kin/domain";
import { randomUUID } from "node:crypto";

/** The rows that example keys such as "elena" or "gas" stand for in one circle. */
export type Rows = {
  readonly circleId: string;
  readonly members: Readonly<Record<string, string>>;
  readonly payees: Readonly<Record<string, string>>;
};

export function rowOf(rows: Readonly<Record<string, string>>, key: string): string {
  const id = rows[key];
  if (id === undefined) throw new Error(`The circle has no row for ${key}`);
  return id;
}

/**
 * An example entry, which names members and payees by key, rewritten for one
 * circle: a fresh ID, and accounts that name that circle's rows.
 */
export function rekeyEntry(entry: LedgerEntry, rows: Rows): LedgerEntry {
  return restoreEntry({
    ...entry,
    id: randomUUID(),
    circleId: rows.circleId,
    // Example months reverse nothing, so no link needs rewriting.
    reverses: null,
    lines: entry.lines.map((line) => ({ ...line, account: rekeyAccount(rows, line.account) })),
  });
}

function rekeyAccount(rows: Rows, code: AccountCode): AccountCode {
  const { family, subject } = describeAccount(code);
  if (subject === null || family === "expense") return code;
  if (family === "payable") return `payable:${rowOf(rows.payees, subject)}`;
  if (family === "member") return `member:${rowOf(rows.members, subject)}`;
  if (family === "care_credit") return `care_credit:${rowOf(rows.members, subject)}`;
  throw new Error(`An account the circle cannot place: ${code}`);
}
