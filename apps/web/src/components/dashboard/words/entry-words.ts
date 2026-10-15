import type { EntryView } from "@/content/demo-circle/record";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { categoryName, isMember, isPayee, nameOf, payeeName } from "./names";

/** The name of whoever or whatever an entry is about. */
function subjectName(dictionary: Dictionary, subject: string): string {
  if (isMember(subject)) return nameOf(dictionary, subject);
  if (isPayee(subject)) return payeeName(dictionary, subject);
  return categoryName(dictionary, subject);
}

/** One ledger entry, said in a short line. */
export function describeEntry(dictionary: Dictionary, view: EntryView): string {
  const template = dictionary.dashboard.record.descriptions[view.entry.kind];
  const name = subjectName(dictionary, view.subject);
  return fill(template, {
    name,
    payee: name,
    category: categoryName(dictionary, view.category ?? view.subject),
  });
}

/** A ledger account, said in words: "Owed to Amara", "Pool cash". */
export function describeAccountCode(dictionary: Dictionary, family: string, subject: string | null): string {
  const accounts: Record<string, string> = dictionary.dashboard.record.accounts;
  const template = accounts[family] ?? family;
  return subject === null ? template : fill(template, { name: subjectName(dictionary, subject) });
}
