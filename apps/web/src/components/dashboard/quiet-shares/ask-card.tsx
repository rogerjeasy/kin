"use client";

import type { QuietShareState } from "@kin/domain";
import { CheckCircle2Icon, CircleSlashIcon, HourglassIcon, InfoIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { useId } from "react";

import { MeterBar } from "@/components/dashboard/ui/meter-bar";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import { Button } from "@/components/ui/button";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";
import type { AskView } from "@/server/quiet-shares";

import { OwnArea } from "./own-area";
import { costWords, type QuietScreen } from "./quiet-screen";
import { useQuietShare } from "./use-quiet-share";

type Props = { screen: QuietScreen; ask: AskView };

const TONES: Record<QuietShareState, { tone: PillTone; icon: LucideIcon }> = {
  gathering: { tone: "waiting", icon: HourglassIcon },
  short: { tone: "danger", icon: TriangleAlertIcon },
  planned: { tone: "waiting", icon: HourglassIcon },
  agreed: { tone: "positive", icon: CheckCircle2Icon },
  withdrawn: { tone: "neutral", icon: CircleSlashIcon },
};

/**
 * One cost the family is covering: what it is, where it stands and how many
 * have answered, which everyone who sees the money reads, and below it the
 * viewer's own private area.
 */
export function AskCard({ screen, ask }: Props) {
  const { copy } = screen;
  const id = useId();
  const format = formatters(screen.locale, screen.currency, screen.timezone);
  const { send, pending, error } = useQuietShare(screen.seat);
  const { tone, icon } = TONES[ask.state];
  const gathering = ask.state === "gathering";
  const progress = gathering
    ? { value: ask.answeredCount, max: ask.askedCount, text: fill(copy.answered, { answered: format.count(ask.answeredCount), asked: format.count(ask.askedCount) }) }
    : ask.state === "planned"
      ? { value: ask.acceptedCount, max: Math.max(1, ask.partCount), text: fill(copy.accepted, { accepted: format.count(ask.acceptedCount), parts: format.count(ask.partCount) }) }
      : null;

  return (
    <article aria-labelledby={`${id}-title`} className="@container min-w-0 space-y-5 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
      <header className="flex min-w-0 flex-col-reverse gap-3 @lg:flex-row @lg:items-start @lg:justify-between">
        <div className="min-w-0 @lg:flex-1">
          <h3 id={`${id}-title`} dir="auto" className="text-xl font-semibold text-balance wrap-break-word">{ask.title}</h3>
          <p className="mt-1 text-base">{costWords(ask, copy.kinds, format)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{fill(copy.raisedBy, { name: ask.raisedByName })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ask.simulated ? <StatusPill tone="neutral">{copy.simulated}</StatusPill> : null}
          <StatusPill tone={tone} icon={icon}>{copy.states[ask.state]}</StatusPill>
        </div>
      </header>
      {progress ? (
        <div className="min-w-0 space-y-2">
          <MeterBar value={progress.value} max={progress.max} fill="fill-share-1" label={progress.text} />
          <p className="text-sm font-medium">{progress.text}</p>
        </div>
      ) : null}
      {ask.payLaterUsed && ask.state !== "short" ? <p className="text-sm text-muted-foreground">{copy.payLaterUsed}</p> : null}
      {ask.privacyCaveat && ask.state !== "withdrawn" ? (
        <p className="flex items-start gap-2 rounded-xl bg-secondary p-3 text-sm">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{copy.caveat}</span>
        </p>
      ) : null}
      <OwnArea screen={screen} ask={ask} />
      {screen.mayRaise && ask.state !== "agreed" && ask.state !== "withdrawn" ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3 border-t pt-4">
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void send({ operation: "withdraw", askId: ask.id })}>
            {copy.withdraw}
          </Button>
          {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
        </div>
      ) : null}
    </article>
  );
}
