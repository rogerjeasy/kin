import type { LedgerEntry } from "@kin/domain";

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

/**
 * What caused an entry, in words. A simulated entry stands in for a PayPal
 * event that never happened, so it is never called a PayPal event.
 */
export function entrySource(dictionary: Dictionary, entry: Pick<LedgerEntry, "simulated" | "source">): string {
  const { record } = dictionary.dashboard;
  return entry.simulated && entry.source.type === "paypal_event" ? record.simulatedSource : record.sources[entry.source.type];
}

/**
 * Which kind of money an entry is: simulated, or a real transaction in
 * PayPal's sandbox. The two are never shown as the same thing (AGENTS.md
 * section 5, rule 9).
 */
export function entryTag(dictionary: Dictionary, entry: { readonly simulated: boolean }): string {
  return entry.simulated ? dictionary.dashboard.common.simulated : dictionary.dashboard.common.sandbox;
}
