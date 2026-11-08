"use client";

import { useState } from "react";

import type { Dictionary } from "@/i18n/dictionary";

import { CoverCard, type CoverItem } from "./cover-card";

type Props = { items: readonly CoverItem[]; copy: Dictionary["dashboard"]["shifts"]; cover: Dictionary["dashboard"]["shiftCover"] };

/**
 * The cancelled shifts that need cover. A card that has been answered stays to
 * say who was put on the calendar, even after the server has stopped listing
 * the shift as one that needs cover.
 */
export function CoverCards({ items, copy, cover }: Props) {
  const [done, setDone] = useState<ReadonlyMap<string, { item: CoverItem; name: string }>>(new Map());
  const gone = [...done.values()].filter((each) => !items.some((item) => item.shiftId === each.item.shiftId)).map((each) => each.item);
  const shown = [...items, ...gone];

  return (
    <section aria-labelledby="cover-title" className="min-w-0 space-y-3">
      <h2 id="cover-title" className="text-lg font-semibold">{cover.title}</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">{cover.decides}</p>
      <ul className="grid min-w-0 gap-4 lg:grid-cols-2">
        {shown.map((item) => (
          <CoverCard key={item.shiftId} item={item} copy={copy} cover={cover} doneName={done.get(item.shiftId)?.name ?? null} onDone={(name) => setDone((previous) => new Map(previous).set(item.shiftId, { item, name }))} />
        ))}
      </ul>
    </section>
  );
}
