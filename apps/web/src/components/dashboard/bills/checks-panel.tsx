import { CheckIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldQuestionIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { cn } from "@/lib/utils";

type Tone = "danger" | "positive" | "waiting";

type ChecksPanelProps = {
  title: string;
  description: string;
  demand: { title: string; text: string; verdict: string; day: string; tone: Tone };
  passed: readonly string[];
};

// A demand that matches nothing, or was already paid, reads as the one to look at; a real bill reads as settled.
const LOOK = {
  danger: { icon: ShieldAlertIcon, box: "border-danger/25 bg-danger/5", edge: "bg-danger/70", badge: "bg-danger/10 text-danger ring-danger/20" },
  positive: { icon: ShieldCheckIcon, box: "border-positive/25 bg-positive/5", edge: "bg-positive/70", badge: "bg-positive/10 text-positive ring-positive/20" },
  waiting: { icon: ShieldQuestionIcon, box: "border-highlight/25 bg-highlight/5", edge: "bg-highlight/70", badge: "bg-highlight/10 text-highlight ring-highlight/20" },
} as const satisfies Record<Tone, { icon: typeof ShieldAlertIcon; box: string; edge: string; badge: string }>;

/** What Kin checked this month: the latest demand, whatever it found, and the bills that passed. */
export function ChecksPanel({ title, description, demand, passed }: ChecksPanelProps) {
  const look = LOOK[demand.tone];
  const Icon = look.icon;
  return (
    <Panel title={title} description={description}>
      <div id="checks" className={cn("relative isolate scroll-mt-24 overflow-hidden rounded-2xl border p-4 sm:p-5", look.box)}>
        <span aria-hidden="true" className={cn("absolute inset-y-0 start-0 w-1", look.edge)} />
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset", look.badge)}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{demand.day}</p>
            <h3 className="text-lg font-semibold tracking-tight text-balance">{demand.title}</h3>
            <StatusPill tone={demand.tone} className="mt-2">
              {demand.verdict}
            </StatusPill>
          </div>
        </div>
        <p className="mt-3 text-pretty wrap-anywhere">{demand.text}</p>
      </div>
      <ul className="mt-5 grid gap-2">
        {passed.map((line) => (
          <li key={line} className="flex min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors duration-300 hover:border-positive/40">
            <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-positive/10 text-positive ring-1 ring-positive/25 ring-inset">
              <CheckIcon className="size-4" />
            </span>
            <span className="min-w-0 text-pretty">{line}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
