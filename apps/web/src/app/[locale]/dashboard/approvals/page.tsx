import { ClockIcon } from "lucide-react";
import type { Metadata } from "next";

import { AnsweredList } from "@/components/dashboard/approvals/answered-list";
import { AnswerButtons } from "@/components/dashboard/approvals/answer-buttons";
import { VoiceAnswer } from "@/components/dashboard/approvals/voice-answer";
import { DecidedList } from "@/components/dashboard/approvals/decided-list";
import { SandboxPayoutProof } from "@/components/dashboard/payouts/sandbox-payout-proof";
import { ProposalCard } from "@/components/dashboard/approvals/proposal-card";
import { RefillsPanel } from "@/components/dashboard/refills/refills-panel";
import { EmptyPanel } from "@/components/dashboard/ui/empty-panel";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { activityItems } from "@/components/dashboard/words/activity-items";
import { proposalCardProps, type CardContext } from "@/components/dashboard/words/proposal-card-props";
import { answeredStatus } from "@/components/dashboard/words/answered-status";
import { proposalStatus, proposalTitle } from "@/components/dashboard/words/proposal-words";
import { circleFormatters } from "@/content/circle/format";
import { parentOf } from "@/content/circle/members";
import { circleNames } from "@/content/circle/names";
import { openPeriod } from "@/content/circle/period";
import { waitingProposals } from "@/content/circle/proposal-view";
import { refillViews } from "@/content/circle/refills";
import { monthTotals, recordEntries } from "@/content/circle/record";
import { voteLine } from "@/content/circle/vote-words";
import { circleSlots } from "@/content/circle/words";
import { mandatesRoute } from "@/content/dashboard-routes";
import { dashboardMetadata } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { dashboardContext, may } from "@/server/dashboard-context";
import { demoPayeeOf, payoutProofsOf } from "@/server/sandbox-payout";
import { speechServices } from "@/server/speech";

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard/approvals">): Promise<Metadata> {
  return dashboardMetadata(params, "approvals");
}

// Everything past waiting: decided, and then paid or failed.
const DECIDED = ["approved", "executing", "settled", "failed", "rejected", "expired", "cancelled"] as const;
const SAID_YES = new Set<string>(["approved", "executing", "settled"]);

export default async function ApprovalsPage({ params }: PageProps<"/[locale]/dashboard/approvals">) {
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "approvals");
  const { approvals, common, empty, notices } = dictionary.dashboard;
  // The spoken answer is for the demo's simulated money: real money needs the fresh check.
  const speechOn = speechServices() !== null;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const period = openPeriod(circle);
  const slots = circleSlots(circle, format);
  const context: CardContext = {
    names,
    format,
    terms: circle.agreement?.approvals ?? null,
    parentId: parentOf(circle)?.id ?? null,
    parent: slots.parent,
    poolCents: may(circle, "money.view") ? monthTotals(circle, period).poolCents : null,
    now: circle.circle.now,
    month: slots.month,
    receiverOf: (payeeId) => circle.payees.find((payee) => payee.id === payeeId)?.receiver ?? null,
    demoPayee: demoPayeeOf(circle),
  };
  const waiting = waitingProposals(circle).toSorted((a, b) => Number(b.viewerCanAnswer) - Number(a.viewerCanAnswer));
  const answered = circle.proposals.filter((proposal) => DECIDED.some((state) => state === proposal.state)).toReversed();
  const decided = recordEntries(circle).filter((view) => view.entry.source.type === "approval");
  const refills = refillViews(circle);
  // A demo payout PayPal's sandbox made shows PayPal's own record, not "simulated".
  const proofs = circle.circle.demo ? (await payoutProofsOf(viewer, circle.circle.id)).byProposal : new Map<string, never>();

  return (
    <>
      <PageHeader title={approvals.title} lede={approvals.lede} />
      <section aria-labelledby="waiting-heading" className="space-y-4">
        <h2 id="waiting-heading" className="flex items-center gap-2.5 text-lg font-semibold">
          {approvals.waitingTitle}
          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-sm tabular-nums">{format.count(waiting.length)}</span>
        </h2>
        {waiting.length === 0 ? <EmptyState text={approvals.waitingEmpty} /> : null}
        {waiting.map((view) => {
          const status = proposalStatus(dictionary, names, format, view);
          return (
            <ProposalCard
              key={view.proposal.id}
              {...proposalCardProps(dictionary, context, view)}
              action={
                view.viewerCanAnswer ? (
                  <AnswerButtons
                    locale={locale}
                    proposalId={view.proposal.id}
                    approve={common.approve}
                    decline={common.decline}
                    freshCheck={circle.circle.demo ? null : { note: approvals.freshCheckNote }}
                    voice={
                      circle.circle.demo && speechOn ? (
                        <VoiceAnswer locale={locale} proposalId={view.proposal.id} copy={approvals.voice} speech={dictionary.dashboard.speech} outcomes={{ approved: notices.approved, rejected: notices.rejected, answered: notices.answered }} />
                      ) : undefined
                    }
                  />
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
      <RefillsPanel
        copy={dictionary.dashboard.refills}
        format={format}
        rules={refills.rules}
        orders={refills.orders}
        sellerName={names.payee}
        simulated={circle.circle.demo}
        mayAsk={may(circle, "refill.propose")}
        mandatesHref={localizedPath(locale, mandatesRoute)}
      />
      {answered.length > 0 ? (
        <AnsweredList
          title={approvals.answered.title}
          description={approvals.answered.text}
          items={answered.map((proposal) => {
            const proof = proofs.get(proposal.id);
            return {
            id: proposal.id,
            title: proposalTitle(dictionary, names, proposal, slots.month),
            kind: common.proposalKinds[proposal.kind],
            amount: format.money(proposal.cents),
            status: answeredStatus(approvals.answered, circle.circle.demo && proof === undefined, proposal.state as (typeof DECIDED)[number]),
            approved: SAID_YES.has(proposal.state),
            answers: proposal.votes
              .map((vote) => voteLine(approvals.slots, { name: names.member(vote.memberId), decision: vote.decision, method: vote.method, time: format.dateTime(vote.at) }))
              .join(" · "),
            proof: proof ? <SandboxPayoutProof proof={proof} copy={dictionary.sandboxPayout} /> : undefined,
            };
          })}
        />
      ) : null}
      {decided.length > 0 ? (
        <DecidedList
          title={fill(approvals.decidedTitle, slots)}
          description={approvals.decidedText}
          simulated={common.simulated}
          items={activityItems(dictionary, names, format, decided)}
        />
      ) : (
        <EmptyPanel title={fill(approvals.decidedTitle, slots)} text={empty.decided} />
      )}
    </>
  );
}
