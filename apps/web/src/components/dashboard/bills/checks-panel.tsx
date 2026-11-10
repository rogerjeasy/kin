import { CheckIcon, ShieldAlertIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill } from "@/components/dashboard/ui/status-pill";

type ChecksPanelProps = {
  title: string;
  description: string;
  demand: { title: string; text: string; verdict: string; day: string };
  passed: readonly string[];
};

/** What Kin checked this month: the false demand it caught, and the bills that passed. */
export function ChecksPanel({ title, description, demand, passed }: ChecksPanelProps) {
  return (
    <Panel title={title} description={description}>
      <div id="checks" className="relative isolate scroll-mt-24 overflow-hidden rounded-2xl border border-danger/25 bg-danger/5 p-4 sm:p-5">
        {/* A red edge down the start side: the caught demand reads as the one to look at. */}
        <span aria-hidden="true" className="absolute inset-y-0 start-0 w-1 bg-danger/70" />
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-danger/10 text-danger ring-1 ring-danger/20 ring-inset">
            <ShieldAlertIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{demand.day}</p>
            <h3 className="text-lg font-semibold tracking-tight text-balance">{demand.title}</h3>
            <StatusPill tone="danger" className="mt-2">
              {demand.verdict}
            </StatusPill>
          </div>
        </div>
        <p className="mt-3 text-pretty">{demand.text}</p>
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
