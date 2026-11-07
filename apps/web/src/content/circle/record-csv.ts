import { decimalAmount, describeAccount } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

import { describeAccountCode, describeEntry } from "@/components/dashboard/words/entry-words";
import type { Dictionary } from "@/i18n/dictionary";

import type { CircleNames } from "./names";
import { recordEntries } from "./record";

// A spreadsheet runs a cell that starts with one of these as a formula, so
// such text is written with a leading apostrophe and read back as text.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** One CSV row, each cell quoted and defused as above. */
export function csvRow(row: readonly string[]): string {
  return row.map(cell).join(",");
}

/**
 * The circle's record as CSV, one row per ledger line, oldest first, in the
 * reader's language. Amounts are exact decimals; every simulated line says so.
 */
export function recordCsv(circle: CircleSnapshot, dictionary: Dictionary, names: CircleNames): string {
  const { record, common } = dictionary.dashboard;
  const { csv } = record;
  const header = [csv.date, csv.entry, csv.kind, csv.account, csv.debit, csv.credit, csv.simulated];
  const rows = recordEntries(circle)
    .toReversed()
    .flatMap((view) => {
      const { entry } = view;
      const text = describeEntry(dictionary, names, view);
      return entry.lines.map((line) => {
        const account = describeAccount(line.account);
        const amount = decimalAmount({ cents: line.cents, currency: entry.currency });
        return [
          entry.occurredOn,
          text,
          common.entryKinds[entry.kind],
          describeAccountCode(dictionary, names, account.family, account.subject),
          line.direction === "debit" ? amount : "",
          line.direction === "credit" ? amount : "",
          entry.simulated ? csv.yes : csv.no,
        ];
      });
    });
  return [header, ...rows].map(csvRow).join("\r\n") + "\r\n";
}
