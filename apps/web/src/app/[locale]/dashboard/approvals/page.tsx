import type { Metadata } from "next";

import { DecidedList } from "@/components/dashboard/approvals/decided-list";
import { ProposalCard } from "@/components/dashboard/approvals/proposal-card";
import { DemoActions } from "@/components/dashboard/ui/demo-actions";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { activityItems } from "@/components/dashboard/words/activity-items";
import { proposalCardProps } from "@/components/dashboard/words/proposal-card-props";
import { proposalStatus } from "@/components/dashboard/words/proposal-words";
import { circleFormatters } from "@/content/demo-circle/format";
import { waitingProposals } from "@/content/demo-circle/proposal-view";
import { monthTotals, recordEntries } from "@/content/demo-circle/record";
import { dashboardMetadata } from "@/i18n/page-context";
import { dashboardContext } from "@/server/dashboard-context";
import { ClockIcon } from "lucide-react";

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard/approvals">): Promise<Metadata> {
  return dashboardMetadata(params, "approvals");
}

export default async function ApprovalsPage({ params }: PageProps<"/[locale]/dashboard/approvals">) {
  const { locale, dictionary } = await dashboardContext(params, "approvals");
  const { approvals, common, demoAction } = dictionary.dashboard;
  const format = circleFormatters(locale);
  const { poolCents } = monthTotals();
  const waiting = waitingProposals().toSorted((a, b) => Number(b.viewerCanAnswer) - Number(a.viewerCanAnswer));
  const decided = recordEntries().filter((view) => view.entry.source.type === "approval");

  return (
    <>
      <PageHeader title={approvals.title} lede={approvals.lede} />
      <section aria-labelledby="waiting-heading" className="space-y-4">
        <h2 id="waiting-heading" className="flex items-center gap-2.5 text-lg font-semibold">
          {approvals.waitingTitle}
          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-sm tabular-nums">{format.count(waiting.length)}</span>
        </h2>
        {waiting.length === 0 ? <p className="text-muted-foreground">{approvals.waitingEmpty}</p> : null}
        {waiting.map((view) => {
          const status = proposalStatus(dictionary, format, view);
          return (
            <ProposalCard
              key={view.proposal.id}
              {...proposalCardProps(dictionary, format, view, poolCents)}
              action={
                view.viewerCanAnswer ? (
                  <DemoActions actions={[{ label: common.approve }, { label: common.decline, variant: "outline" }]} note={demoAction} />
                ) : (
                  <StatusPill tone={status.tone} icon={ClockIcon} className="text-sm">
                    {status.text}
                  </StatusPill>
                )
              }
            />
          );
        })}
      </section>
      <DecidedList
        title={approvals.decidedTitle}
        description={approvals.decidedText}
        simulated={common.simulated}
        items={activityItems(dictionary, format, decided)}
      />
    </>
  );
}
