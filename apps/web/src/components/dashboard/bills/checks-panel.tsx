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
      <div id="checks" className="scroll-mt-24 rounded-xl border border-danger/25 bg-danger/5 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger">
            <ShieldAlertIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{demand.day}</p>
            <h3 className="font-semibold text-balance">{demand.title}</h3>
            <StatusPill tone="danger" className="mt-2">
              {demand.verdict}
            </StatusPill>
          </div>
        </div>
        <p className="mt-3 text-pretty">{demand.text}</p>
      </div>
      <ul className="mt-5 space-y-3">
        {passed.map((line) => (
          <li key={line} className="flex items-center gap-3">
            <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-positive/10 text-positive">
              <CheckIcon className="size-3.5" />
            </span>
            {line}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
