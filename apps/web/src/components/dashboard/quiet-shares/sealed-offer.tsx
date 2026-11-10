"use client";

import type { OwnOfferRecord } from "@kin/db";
import { LockKeyholeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";

import { offerSummary, type QuietScreen } from "./quiet-screen";

type Props = { screen: QuietScreen; offer: OwnOfferRecord; sealsLeft: number; canChange: boolean; onChange: () => void };

/** The person's own sealed offer, in their words back to them, which only they can read. */
export function SealedOffer({ screen, offer, sealsLeft, canChange, onChange }: Props) {
  const { copy } = screen;
  const format = formatters(screen.locale, screen.currency, screen.timezone);
  return (
    <div className="enter relative min-w-0 space-y-3 overflow-clip rounded-2xl border border-positive/30 bg-positive/5 p-4 sm:p-5">
      <p className="flex items-center gap-3 font-semibold">
        <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-positive shadow-[0_0_0_1px_color-mix(in_oklab,var(--positive)_30%,transparent),0_0_22px_-4px_rgb(var(--glow-gold)/0.6)]">
          <LockKeyholeIcon className="size-5" />
        </span>
        <span className="min-w-0">{copy.offer.sealedTitle}</span>
      </p>
      <p className="text-lg text-pretty">{fill(copy.offer.sealed, { summary: offerSummary(offer, copy.offer.summary, format) })}</p>
      {canChange && sealsLeft > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button type="button" variant="outline" className="min-h-11" onClick={onChange}>
            {copy.offer.change}
          </Button>
          <span className="text-sm text-muted-foreground">{fill(copy.offer.sealsLeft, { count: format.count(sealsLeft) })}</span>
        </div>
      ) : null}
    </div>
  );
}
