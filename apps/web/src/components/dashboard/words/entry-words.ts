import type { CircleNames } from "@/content/circle/names";
import type { EntryView } from "@/content/circle/record";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

/** One ledger entry, said in a short line. */
export function describeEntry(dictionary: Dictionary, names: CircleNames, view: EntryView): string {
  const template = dictionary.dashboard.record.descriptions[view.entry.kind];
  const name = names.subject(view.subject);
  return fill(template, {
    name,
    payee: name,
    category: names.category(view.category ?? view.subject),
    parent: names.parent,
  });
}

/** A ledger account, said in words: "Owed to Amara", "Pool cash". */
export function describeAccountCode(dictionary: Dictionary, names: CircleNames, family: string, subject: string | null): string {
  const accounts: Record<string, string> = dictionary.dashboard.record.accounts;
  const template = accounts[family] ?? family;
  return subject === null ? template : fill(template, { name: names.subject(subject) });
}
