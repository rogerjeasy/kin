import { AlertTriangleIcon, CheckCircle2Icon, ClockIcon, HelpCircleIcon, MessageSquareIcon, ShieldAlertIcon } from "lucide-react";

import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
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

/** A check's state in words, colour and an icon, so colour is never the only sign. */
export function StatePill({ state, copy }: { state: CheckView["state"]; copy: Copy }) {
  return (
    <StatusPill tone={LOOK[state].tone} icon={LOOK[state].icon}>
      {copy.states[state]}
    </StatusPill>
  );
}

type Props = { check: CheckView; copy: Copy; format: Formatters };

/**
 * What came of one check: who was asked and what they said, what Kin tells the
 * parent (the one fixed sentence for this state), the amount asked for, and the
 * scam signs found in the words. Everything on it comes from the record.
 */
export function CheckResult({ check, copy, format }: Props) {
  const open = check.state === "opened" || check.state === "asked";
  return (
    <div role="status" aria-live="polite" className="min-w-0 space-y-4 rounded-xl border bg-secondary/40 p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <StatePill state={check.state} copy={copy} />
        {open && check.voiceName !== null ? <p className="min-w-0 text-sm text-muted-foreground">{fill(copy.waiting, { name: check.voiceName })}</p> : null}
        {check.matched ? null : <p className="min-w-0 text-sm text-muted-foreground">{copy.unknownPerson}</p>}
      </div>
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-semibold">{copy.kinSays}</h3>
        <p className="text-xl font-semibold text-pretty wrap-anywhere">{check.replyText}</p>
      </div>
      <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-sm font-semibold">{copy.amountLabel}</dt>
          <dd className="text-sm">{check.claimedCents === null ? copy.noAmount : format.money(check.claimedCents)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-sm font-semibold">
            <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
            {copy.markersTitle}
          </dt>
          <dd className="text-sm">{check.markers.length === 0 ? copy.noMarkers : check.markers.map((marker) => copy.markers[marker]).join(", ")}</dd>
        </div>
      </dl>
      {check.holdUntil !== null ? (
        <p className="text-sm font-medium">{fill(copy.hold, { time: format.dateTime(new Date(check.holdUntil)) })}</p>
      ) : null}
    </div>
  );
}
