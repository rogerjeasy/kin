import { CheckCircle2Icon, CirclePauseIcon, ClockIcon, XCircleIcon } from "lucide-react";

import { Person } from "@/components/dashboard/ui/person";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";

const STATE_LOOK = {
  approval_pending: { tone: "waiting", icon: ClockIcon },
  active: { tone: "positive", icon: CheckCircle2Icon },
  paused: { tone: "neutral", icon: CirclePauseIcon },
  cancelled: { tone: "neutral", icon: XCircleIcon },
} as const satisfies Record<string, { tone: PillTone; icon: typeof ClockIcon }>;

export type ShareItem = {
  id: string;
  portrait: string | null;
  name: string;
  /** "$150.00 a month". */
  amount: string;
  state: keyof typeof STATE_LOOK;
  stateLabel: string;
  /** Short sentences under the amount: the next charge, a failed charge. */
  notes: readonly string[];
  /** "Simulated", for a demo circle's share. */
  badge: string | null;
};

/** Every member's monthly share, in words and colour, with a note for what needs attention. */
export function ShareList({ items }: { items: readonly ShareItem[] }) {
  return (
    <ul className="divide-y border-t">
      {items.map((item) => (
        <li key={item.id} className="grid min-w-0 gap-x-4 gap-y-2 px-5 py-4 transition-colors duration-300 hover:bg-muted/50 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:px-6">
          <Person portrait={item.portrait} name={item.name} detail={item.amount} />
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 ps-12 sm:ps-0">
            <StatusPill tone={STATE_LOOK[item.state].tone} icon={STATE_LOOK[item.state].icon}>
              {item.stateLabel}
            </StatusPill>
            {item.badge ? <span className="text-xs font-semibold text-muted-foreground">{item.badge}</span> : null}
            {item.notes.map((note) => (
              <p key={note} className="min-w-0 text-sm text-pretty text-muted-foreground wrap-anywhere">
                {note}
              </p>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
