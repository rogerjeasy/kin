"use client";

import { useState } from "react";

import type { ShiftCopy } from "@/content/circle/shift-words";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { formatters } from "@/lib/format";

import { NeedCard, type NeedAnswer, type NeedItem } from "./need-card";

type Props = {
  items: readonly NeedItem[];
  copy: ShiftCopy;
  locale: Locale;
  currency: string;
  timezone: string;
  parent: string;
  approvalsHref: string;
  calls: Dictionary["dashboard"]["shiftCalls"];
};

/**
 * What the viewer is asked for now, as big cards. A card that has been
 * answered stays to say what came of it, even after the server has moved the
 * shift on and no longer lists it, until the screen is left or a newer ask
 * for the same shift (checking out after checking in) replaces it.
 */
export function NeedsCards({ items, copy, locale, currency, timezone, parent, approvalsHref, calls }: Props) {
  const [answers, setAnswers] = useState<ReadonlyMap<string, { item: NeedItem; answer: NeedAnswer }>>(new Map());
  const format = formatters(locale, currency, timezone);
  const remember = (item: NeedItem, value: NeedAnswer) => setAnswers((previous) => new Map(previous).set(item.shiftId, { item, answer: value }));
  const gone = [...answers.values()].filter((each) => !items.some((item) => item.shiftId === each.item.shiftId));
  const shown = [...items.map((item) => ({ item, answer: answers.get(item.shiftId)?.answer ?? null })), ...gone];
  if (shown.length === 0) return null;

  return (
    <section aria-labelledby="needs-title" className="min-w-0 space-y-3">
      <h2 id="needs-title" className="text-lg font-semibold">{copy.needs.title}</h2>
      <ul className="grid min-w-0 gap-4 lg:grid-cols-2">
        {shown.map(({ item, answer: shownAnswer }) => (
          <NeedCard key={item.shiftId} item={item} answer={shownAnswer} copy={copy} format={format} parent={parent} approvalsHref={approvalsHref} locale={locale} calls={calls} onAnswer={(value) => remember(item, value)} />
        ))}
      </ul>
    </section>
  );
}
