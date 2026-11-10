import { AlertTriangleIcon, CheckCircle2Icon, ClockIcon, HelpCircleIcon, LockIcon, MessageSquareIcon, ShieldAlertIcon } from "lucide-react";

import { KinMark } from "@/components/dashboard/ai/kin-mark";
import { RisingFigure } from "@/components/motion/rising-figure";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CheckView } from "@/server/presence";

type Copy = Dictionary["dashboard"]["presence"];

const LOOK = {
  opened: { tone: "waiting", icon: MessageSquareIcon },
  asked: { tone: "waiting", icon: ClockIcon },
  confirmed: { tone: "positive", icon: CheckCircle2Icon },
  denied: { tone: "danger", icon: ShieldAlertIcon },
  unanswered: { tone: "waiting", icon: HelpCircleIcon },
  expired: { tone: "neutral", icon: HelpCircleIcon },
} as const satisfies Record<CheckView["state"], { tone: PillTone; icon: typeof ClockIcon }>;

/**
 * A check's state in words, colour and an icon, so colour is never the only
 * sign. A caller nobody on the list goes by was never asked about, so that
 * check says so instead of "could not be reached".
 */
export function StatePill({ check, copy }: { check: Pick<CheckView, "state" | "matched">; copy: Copy }) {
  if (!check.matched && check.state !== "opened" && check.state !== "asked") {
    return (
      <StatusPill tone="danger" icon={ShieldAlertIcon}>
        {copy.notOnList}
      </StatusPill>
    );
  }
  return (
    <StatusPill tone={LOOK[check.state].tone} icon={LOOK[check.state].icon}>
      {copy.states[check.state]}
    </StatusPill>
  );
}

type Props = { check: CheckView; copy: Copy; format: Formatters };

/** The light around a check, by how it ended. Decorative: the pill and the sentence carry the meaning. */
function frame(check: CheckView): string {
  if (check.state === "confirmed") return "border-positive/40 shadow-[0_0_48px_-18px_var(--positive)]";
  if (check.state === "denied" || !check.matched) return "border-danger/40 shadow-[0_0_48px_-18px_var(--danger)]";
  return "border-gold/40 shadow-[0_0_48px_-18px_rgb(var(--glow-gold))]";
}

/**
 * What came of one check: who was asked and what they said, what Kin tells the
 * parent (the one fixed sentence for this state), the amount asked for, and the
 * scam signs found in the words. Everything on it comes from the record.
 */
export function CheckResult({ check, copy, format }: Props) {
  const open = check.state === "opened" || check.state === "asked";
  return (
    <div role="status" aria-live="polite" className={cn("min-w-0 space-y-5 rounded-3xl border bg-muted/60 p-4 motion-safe:animate-scale-in sm:p-5", frame(check))}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <StatePill check={check} copy={copy} />
        {open && check.voiceName !== null ? <p className="min-w-0 text-sm text-muted-foreground">{fill(copy.waiting, { name: check.voiceName })}</p> : null}
        {check.matched ? null : <p className="min-w-0 text-sm text-muted-foreground">{copy.unknownPerson}</p>}
      </div>
      <div className="flex min-w-0 items-start gap-3">
        <KinMark active={open} />
        <div className="min-w-0 flex-1 space-y-1.5 rounded-3xl rounded-ss-md border bg-card px-4 py-3.5 shadow-sm">
          <h3 className="text-xs font-semibold tracking-wide text-highlight">{copy.kinSays}</h3>
          <p className="font-serif text-2xl leading-snug text-pretty wrap-anywhere">{check.replyText}</p>
        </div>
      </div>
      <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-2xl border bg-card p-4">
          <dt className="text-sm font-semibold text-muted-foreground">{copy.amountLabel}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{check.claimedCents === null ? <span className="text-base font-normal">{copy.noAmount}</span> : <RisingFigure value={format.money(check.claimedCents)} />}</dd>
        </div>
        <div className="min-w-0 rounded-2xl border bg-card p-4">
          <dt className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0 text-danger" />
            {copy.markersTitle}
          </dt>
          <dd className="mt-2 text-sm">
            {check.markers.length === 0 ? (
              copy.noMarkers
            ) : (
              <ul className="enter-stagger flex min-w-0 flex-wrap gap-1.5">
                {check.markers.map((marker) => (
                  <li key={marker} className="max-w-full rounded-full bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger ring-1 ring-inset ring-danger/20 wrap-anywhere">
                    {copy.markers[marker]}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      {check.holdUntil !== null ? (
        <p className="flex min-w-0 items-start gap-2.5 rounded-2xl bg-highlight/10 p-3 text-sm font-medium ring-1 ring-inset ring-gold/40">
          <LockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
          <span className="min-w-0">{fill(copy.hold, { time: format.dateTime(new Date(check.holdUntil)) })}</span>
        </p>
      ) : null}
    </div>
  );
}
