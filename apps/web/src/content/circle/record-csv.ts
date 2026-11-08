import { decimalAmount, describeAccount } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

import { describeAccountCode, describeEntry } from "@/components/dashboard/words/entry-words";
import type { Dictionary } from "@/i18n/dictionary";
import { csvRow } from "@/lib/csv-cell";

import type { CircleNames } from "./names";
import { recordEntries } from "./record";

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
