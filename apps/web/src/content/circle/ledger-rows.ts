import type { CircleSnapshot } from "@kin/db";
import { describeAccount, sumCents } from "@kin/domain";

import { FILTER_OF } from "@/components/dashboard/record/record-filters";
import type { LedgerRow } from "@/components/dashboard/record/ledger-row";
import { describeAccountCode, describeEntry, entryTag } from "@/components/dashboard/words/entry-words";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import type { CircleNames } from "./names";
import { recordEntries } from "./record";

/**
 * The circle's ledger as rows for the Record, the statement and the audit
 * trail: each entry in the reader's words, with its amount as integer cents
 * beside the same amount written for display, and the proof that backs it (its
 * cause and that cause's ID). Newest day first.
 */
export function ledgerRows(circle: CircleSnapshot, dictionary: Dictionary, names: CircleNames, format: Formatters): LedgerRow[] {
  const { record, common } = dictionary.dashboard;
  const noCategory = dictionary.dataGrid.totals.noCategory;

  return recordEntries(circle).map((view) => {
    const { entry } = view;
    const month = entry.occurredOn.slice(0, 7);
    const note = entry.kind === "care_credit" ? record.careNote : view.feeCents > 0 ? fill(record.fee, { fee: format.money(view.feeCents) }) : null;
    // A purchase is for the parent, whatever it bought, so it groups under the parent's name.
    const person = entry.kind === "purchase_captured" || entry.kind === "purse_funded" || entry.kind === "purse_paid" ? { key: "parent", label: names.parent } : { key: view.subject, label: names.subject(view.subject) };
    return {
      rowKind: "entry",
      id: entry.id,
      filter: FILTER_OF[entry.kind],
      isoDay: entry.occurredOn,
      period: entry.period,
      cents: view.cents,
      flow: view.poolFlow,
      day: format.day(entry.occurredOn),
      text: describeEntry(dictionary, names, view),
      kind: common.entryKinds[entry.kind],
      source: record.sources[entry.source.type],
      sourceId: entry.source.id,
      reverses: entry.reverses,
      simulated: entry.simulated,
      amount: format.money(view.cents),
      note,
      tags: [entryTag(dictionary, entry)],
      person,
      category: view.category === null ? { key: "none", label: noCategory } : { key: view.category, label: names.category(view.category) },
      month: { key: month, label: format.month(month) },
      debitCents: sumCents(entry.lines.filter((line) => line.direction === "debit").map((line) => line.cents)),
      creditCents: sumCents(entry.lines.filter((line) => line.direction === "credit").map((line) => line.cents)),
      lines: entry.lines.map((line) => {
        const account = describeAccount(line.account);
        const amount = format.money(line.cents);
        return {
          account: describeAccountCode(dictionary, names, account.family, account.subject),
          debit: line.direction === "debit" ? amount : "",
          credit: line.direction === "credit" ? amount : "",
        };
      }),
    };
  });
}
