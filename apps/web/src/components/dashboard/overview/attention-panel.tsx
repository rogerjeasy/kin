import type { ProposalKind } from "@kin/domain";
import Link from "next/link";

import { proposalKindIcons } from "@/components/dashboard/ui/kind-icons";
import { IconTile } from "@/components/dashboard/ui/icon-tile";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";

export type AttentionItem = {
  id: string;
  href: string;
  kind: ProposalKind;
  kindLabel: string;
  title: string;
  amount: string;
  status: { tone: PillTone; text: string };
};

type AttentionPanelProps = {
  title: string;
  link: { href: string; label: string };
  items: readonly AttentionItem[];
  className?: string;
};

/** What is waiting for a yes, with whose yes it waits for. */
export function AttentionPanel({ title, link, items, className }: AttentionPanelProps) {
  return (
    <Panel title={title} link={link} flush className={className}>
      <ul className="divide-y border-t">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-muted/60 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-6">
              <IconTile icon={proposalKindIcons[item.kind]} />
              <div className="min-w-0">
                <p className="font-semibold text-pretty">{item.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{item.kindLabel}</p>
              </div>
              <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:col-start-3 sm:flex-col sm:items-end">
                <span className="font-semibold tabular-nums">{item.amount}</span>
                <StatusPill tone={item.status.tone}>{item.status.text}</StatusPill>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
