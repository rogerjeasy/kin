import { ArrowDownLeftIcon, ArrowUpRightIcon, CpuIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill } from "@/components/dashboard/ui/status-pill";

export type MovementGroup = {
  title: string;
  direction: "in" | "out";
  /** `extra` is shown under a movement, such as the PayPal invoice behind a collection. */
  items: readonly { id: string; who: string; amount: string; detail: string; extra?: ReactNode }[];
};

type SettlementPanelProps = {
  title: string;
  description: string;
  status: string;
  groups: readonly MovementGroup[];
  core: string;
  link: { href: string; label: string };
};

/** The movements that close the month, as the money core planned them. */
export function SettlementPanel({ title, description, status, groups, core, link }: SettlementPanelProps) {
  return (
    <Panel title={title} description={description} link={link} aside={<StatusPill tone="waiting">{status}</StatusPill>}>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((group) => {
          const Icon = group.direction === "in" ? ArrowDownLeftIcon : ArrowUpRightIcon;
          return (
            <section key={group.title} aria-label={group.title} className="rounded-xl border p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                {group.title}
              </h3>
              <ul className="mt-3 divide-y">
                {group.items.map((item) => (
                  <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{item.who}</p>
                        <p className="text-sm text-muted-foreground">{item.detail}</p>
                      </div>
                      <span className="text-lg font-semibold whitespace-nowrap tabular-nums">{item.amount}</span>
                    </div>
                    {item.extra}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="mt-5 flex items-start gap-2.5 text-sm text-muted-foreground">
        <CpuIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {core}
      </p>
    </Panel>
  );
}
