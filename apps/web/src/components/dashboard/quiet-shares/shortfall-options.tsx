"use client";

import { SPREAD_MONTHS } from "@kin/domain";
import { CalendarRangeIcon, WalletCardsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";
import type { AskView } from "@/server/quiet-shares";

import type { QuietScreen } from "./quiet-screen";
import { useQuietShare } from "./use-quiet-share";

type Props = { screen: QuietScreen; ask: AskView };

/**
 * The offers fall short. Kin says only by how much, never whose, and offers
 * the ways to close the gap: spreading a one-off cost over months (the
 * organizer's choice), or one person privately taking the gap on with PayPal
 * Pay Later. Raising one's own offer stays possible beside it.
 */
export function ShortfallOptions({ screen, ask }: Props) {
  const { copy } = screen;
  const words = copy.short;
  const format = formatters(screen.locale, screen.currency, screen.timezone);
  const { send, pending, error } = useQuietShare(screen.seat);
  const shortfall = format.money(ask.shortfallCents ?? 0);
  const months = format.count(SPREAD_MONTHS);
  const canSpread = ask.kind === "one_off" && ask.months === 1;

  return (
    <div className="enter min-w-0 space-y-4 rounded-2xl border-2 border-highlight/40 bg-highlight/5 p-4 shadow-[0_0_0_4px_rgb(var(--glow-gold)/0.08)] sm:p-5">
      <div className="min-w-0">
        <p className="text-lg font-semibold text-balance">{fill(words.title, { shortfall })}</p>
        <p className="mt-1 text-sm text-muted-foreground">{words.text}</p>
      </div>
      {canSpread ? (
        <div className="min-w-0 space-y-2">
          <p className="text-sm">{ask.spreadWouldCover ? fill(words.spreadCovers, { months }) : words.spreadShort}</p>
          {screen.mayRaise ? (
            <Button type="button" variant="outline" disabled={pending} onClick={() => void send({ operation: "spread", askId: ask.id })} className="h-auto min-h-11 max-w-full whitespace-normal text-start">
              <CalendarRangeIcon aria-hidden="true" />
              {fill(words.spread, { months })}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{words.spreadOrganizer}</p>
          )}
        </div>
      ) : null}
      {ask.kind === "one_off" && ask.iAmAsked && screen.mayOffer ? (
        <div className="min-w-0 space-y-2 border-t pt-4">
          <p className="text-sm">{fill(words.payLaterText, { shortfall })}</p>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void send({ operation: "take_gap", askId: ask.id })} className="h-auto min-h-11 max-w-full whitespace-normal text-start">
            <WalletCardsIcon aria-hidden="true" />
            {words.payLater}
          </Button>
        </div>
      ) : null}
      {ask.iAmAsked && screen.mayOffer ? <p className="text-sm text-muted-foreground">{words.raise}</p> : null}
      {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
    </div>
  );
}
