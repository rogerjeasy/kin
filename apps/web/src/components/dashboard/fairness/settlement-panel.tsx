import { ArrowDownLeftIcon, ArrowUpRightIcon, CpuIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { cn } from "@/lib/utils";

export type MovementGroup = {
  title: string;
  direction: "in" | "out";
  /** `note` says why, in a sentence; `extra` is shown under a movement, such as the PayPal invoice behind a collection. */
  items: readonly { id: string; who: string; amount: string; detail: string; note?: string; extra?: ReactNode }[];
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
            <section key={group.title} aria-label={group.title} className="min-w-0 rounded-2xl border bg-muted/60 p-4 sm:p-5">
              <h3 className="flex items-center gap-2.5 text-sm font-semibold">
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-8 items-center justify-center rounded-full ring-1 ring-inset",
                    group.direction === "in" ? "bg-positive/10 text-positive ring-positive/25" : "bg-highlight/10 text-highlight ring-highlight/25",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                {group.title}
              </h3>
              <ul className="mt-4 space-y-2">
                {group.items.map((item) => (
                  <li key={item.id} className="rounded-xl border bg-card p-3.5 shadow-2xs transition-[border-color,box-shadow] duration-300 hover:border-gold/50 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{item.who}</p>
                        <p className="text-sm text-pretty text-muted-foreground">{item.detail}</p>
                      </div>
                      <span className="font-serif text-2xl leading-none whitespace-nowrap tabular-nums">{item.amount}</span>
                    </div>
                    {item.note ? <p className="mt-2 text-sm text-pretty text-muted-foreground">{item.note}</p> : null}
                    {item.extra}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="mt-5 flex items-start gap-2.5 text-sm text-muted-foreground">
        <CpuIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
        {core}
      </p>
    </Panel>
  );
}
