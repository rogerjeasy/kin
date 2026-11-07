import type { AnnounceEvery } from "@/content/circle/announcements";
import type { CircleNames } from "@/content/circle/names";
import type { EntryView } from "@/content/circle/record";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

type Listen = Dictionary["dashboard"]["listen"];

/**
 * One confirmed money event as one calm sentence. Fixed wording filled from
 * the record, never written by a model, so every name and amount it speaks is
 * the one the screen shows (AGENTS.md section 7). Simulated money says so.
 */
export function announcementSentence(copy: Listen, names: CircleNames, format: Formatters, view: EntryView): string {
  const { kind } = view.entry;
  const template = kind === "contribution" ? copy.sentences.contribution : kind === "payout_confirmed" ? copy.sentences.payout : copy.sentences.purchase;
  const sentence = fill(template, {
    name: names.subject(view.subject),
    payee: names.subject(view.subject),
    category: names.category(view.category ?? view.subject),
    parent: names.parent,
    amount: format.money(view.cents),
  });
  return view.entry.simulated ? `${sentence} ${copy.simulated}` : sentence;
}

/** Everything said for one rhythm: an opening line for a digest, then each event. */
export function announcementText(copy: Listen, names: CircleNames, format: Formatters, views: readonly EntryView[], every: AnnounceEvery): string {
  const sentences = views.map((view) => announcementSentence(copy, names, format, view));
  return every === "now" ? sentences.join(" ") : [copy.intro[every], ...sentences].join(" ");
}
