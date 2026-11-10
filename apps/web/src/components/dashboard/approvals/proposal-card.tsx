import type { ProposalKind } from "@kin/domain";
import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import { proposalKindIcons } from "@/components/dashboard/ui/kind-icons";
import { IconTile } from "@/components/dashboard/ui/icon-tile";
import { RisingFigure } from "@/components/motion/rising-figure";
import { Tag } from "@/components/shared/tag";

import { ApprovalSlots, type SlotItem } from "./approval-slots";

export type ProposalCardProps = {
  id: string;
  kind: ProposalKind;
  kindLabel: string;
  title: string;
  text: string;
  amount: string;
  /** "Raised by Elena, Oct 29 3:00 PM" and "Expires in 21 hours". */
  meta: readonly string[];
  /** What is unusual about it: a new payee, a member being paid. */
  notes: readonly string[];
  slotsLabel: string;
  progress: string;
  slots: readonly SlotItem[];
  /** The viewer's answer buttons, or where it stands when the viewer has no turn. */
  action: ReactNode;
};

/** One movement of money waiting for its yeses. */
export function ProposalCard({ id, kind, kindLabel, title, text, amount, meta, notes, slotsLabel, progress, slots, action }: ProposalCardProps) {
  return (
    <article id={id} aria-labelledby={`${id}-title`} className="surface lift glow-edge scroll-mt-24 rounded-3xl p-5 sm:p-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-start gap-4">
            <IconTile icon={proposalKindIcons[kind]} className="size-12 rounded-2xl text-highlight shadow-[inset_0_1px_0_rgb(var(--sheen)/0.6),inset_0_0_0_1px_var(--border),0_0_22px_-6px_rgb(var(--glow-gold)/0.55)]" />
            <div className="min-w-0 flex-1">
              <Tag>{kindLabel}</Tag>
              <h3 id={`${id}-title`} className="mt-2 text-xl font-semibold tracking-tight text-balance">
                {title}
              </h3>
            </div>
            <p className="w-full font-serif text-figure tracking-tight tabular-nums sm:w-auto">
              <RisingFigure value={amount} />
            </p>
          </div>
          <p className="mt-4 text-lede text-pretty">{text}</p>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
            {meta.map((line) => (
              <li key={line} className="rounded-full bg-secondary px-3 py-1">
                {line}
              </li>
            ))}
          </ul>
          {notes.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {notes.map((note) => (
                <li key={note} className="flex gap-2.5 rounded-xl border border-highlight/20 bg-highlight/5 px-3 py-2.5 text-sm">
                  <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
                  <span className="min-w-0">{note}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-6 xl:mt-auto xl:pt-6">{action}</div>
        </div>
        <ApprovalSlots label={slotsLabel} progress={progress} slots={slots} />
      </div>
    </article>
  );
}
