import { decimalAmount, describeAccount } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

import { describeAccountCode, describeEntry } from "@/components/dashboard/words/entry-words";
import type { Dictionary } from "@/i18n/dictionary";

import type { CircleNames } from "./names";
import { recordEntries } from "./record";
import { csvRow } from "./record-csv";

/**
 * The audit export: one row per ledger line, oldest first, each carrying the
 * entry's ID, its cause (a PayPal event, an approval or a settlement, with its
 * ID) and the entry it reverses, so a line can be traced to its evidence.
 */
export function auditCsv(circle: CircleSnapshot, dictionary: Dictionary, names: CircleNames): string {
  const { record, statement } = dictionary.dashboard;
  const { csv } = statement.audit;
  const header = [csv.date, csv.id, csv.entry, csv.kind, csv.source, csv.reference, csv.reverses, csv.account, csv.debit, csv.credit, csv.currency, csv.simulated];
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
          entry.id,
          text,
          dictionary.dashboard.common.entryKinds[entry.kind],
          record.sources[entry.source.type],
          entry.source.id,
          entry.reverses ?? "",
          describeAccountCode(dictionary, names, account.family, account.subject),
          line.direction === "debit" ? amount : "",
          line.direction === "credit" ? amount : "",
          entry.currency,
          entry.simulated ? csv.yes : csv.no,
        ];
      });
    });
  return [header, ...rows].map(csvRow).join("\r\n") + "\r\n";
}
