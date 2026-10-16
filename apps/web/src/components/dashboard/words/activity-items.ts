import type { ActivityItem } from "@/components/dashboard/overview/activity-panel";
import type { CircleNames } from "@/content/circle/names";
import type { EntryView } from "@/content/circle/record";
import type { Dictionary } from "@/i18n/dictionary";
import type { Formatters } from "@/lib/format";

import { describeEntry, entryTag } from "./entry-words";

/** Ledger entries as short lines: when, what, and how much. */
export function activityItems(dictionary: Dictionary, names: CircleNames, format: Formatters, entries: readonly EntryView[]): ActivityItem[] {
  return entries.map((view) => ({
    id: view.entry.id,
    day: format.day(view.entry.occurredOn),
    text: describeEntry(dictionary, names, view),
    kind: dictionary.dashboard.common.entryKinds[view.entry.kind],
    amount: format.money(view.cents),
    flow: view.poolFlow,
    simulated: view.entry.simulated,
    // Simulated history needs no tag in a list of it; a real sandbox payment beside it does.
    tag: view.entry.simulated ? null : entryTag(dictionary, view.entry),
  }));
}
