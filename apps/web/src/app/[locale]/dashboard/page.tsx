import type { Metadata } from "next";
import Link from "next/link";

import { ActivityPanel } from "@/components/dashboard/overview/activity-panel";
import { AttentionPanel } from "@/components/dashboard/overview/attention-panel";
import { ComingUpPanel } from "@/components/dashboard/overview/coming-up-panel";
import { FairnessPanel } from "@/components/dashboard/overview/fairness-panel";
import { RoseHeardPanel } from "@/components/dashboard/overview/rose-heard-panel";
import { SafetyPanel } from "@/components/dashboard/overview/safety-panel";
import { SpendingPanel } from "@/components/dashboard/overview/spending-panel";
import { StatRow } from "@/components/dashboard/overview/stat-row";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { activityItems } from "@/components/dashboard/words/activity-items";
import { attentionItems } from "@/components/dashboard/words/attention-items";
import { givenRows } from "@/components/dashboard/words/given-rows";
import { categoryName, nameOf, payeeName } from "@/components/dashboard/words/names";
import { planLabel } from "@/components/dashboard/words/plan-words";
import { ButtonLink } from "@/components/shared/button-link";
import { Button } from "@/components/ui/button";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { falseDemand } from "@/content/demo-circle/claim-check";
import { DEMO_NOW } from "@/content/demo-circle/clock";
import { memberFairness, monthSettlement } from "@/content/demo-circle/fairness";
import { circleFormatters } from "@/content/demo-circle/format";
import { roseHeard } from "@/content/demo-circle/narrations";
import { waitingProposals } from "@/content/demo-circle/proposal-view";
import { monthTotals, recordEntries, spendingByCategory } from "@/content/demo-circle/record";
import { upcomingBills } from "@/content/demo-circle/upcoming";
import { dashboardMetadata } from "@/i18n/page-context";
import { dashboardContext } from "@/server/dashboard-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { sumCents } from "@kin/domain";

const RECENT_ENTRIES = 8;

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard">): Promise<Metadata> {
  return dashboardMetadata(params, "overview");
}

export default async function OverviewPage({ params }: PageProps<"/[locale]/dashboard">) {
  const { locale, dictionary, session } = await dashboardContext(params, "overview");
  const { overview, common } = dictionary.dashboard;
  const format = circleFormatters(locale);
  const path = (route: string) => localizedPath(locale, route);
  const name = (id: Parameters<typeof nameOf>[1]) => nameOf(dictionary, id);

  const totals = monthTotals();
  const waiting = waitingProposals();
  const spending = spendingByCategory();
  const settlement = monthSettlement();
  const contributors = memberFairness(settlement).filter((member) => member.input.paidInCents > 0);

  return (
    <>
      <PageHeader
        eyebrow={format.longDay(DEMO_NOW)}
        title={fill(overview.greeting, { name: session.name })}
        lede={overview.lede}
        actions={
          <>
            <ButtonLink href={path(dashboardRoutes.approvals)} size="sm">
              {overview.actions.approvals}
            </ButtonLink>
            <Button asChild variant="outline" size="sm">
              <Link href={path(dashboardRoutes.fairness)}>{overview.actions.settlement}</Link>
            </Button>
          </>
        }
      />
      <StatRow
        label={overview.stats.label}
        pool={{ label: overview.stats.pool.label, value: format.money(totals.poolCents), note: overview.stats.pool.note }}
        paidIn={{
          label: overview.stats.paidIn.label,
          value: format.money(totals.paidInCents),
          note: fill(overview.stats.paidIn.note, { names: format.allOf(contributors.map((member) => name(member.memberId))) }),
        }}
        paidOut={{
          label: overview.stats.paidOut.label,
          value: format.money(totals.paidOutCents),
          note: fill(overview.stats.paidOut.note, { fees: format.money(totals.feesCents) }),
        }}
        waiting={{
          label: overview.stats.waiting.label,
          value: format.count(waiting.length),
          note: fill(overview.stats.waiting.note, { amount: format.money(sumCents(waiting.map((view) => view.proposal.cents))) }),
        }}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <AttentionPanel
          className="lg:col-span-2"
          title={overview.attention.title}
          link={{ href: path(dashboardRoutes.approvals), label: overview.attention.link }}
          items={attentionItems(locale, dictionary, format, waiting)}
        />
        <SafetyPanel
          title={overview.safety.title}
          text={fill(overview.safety.text, {
            claimed: format.money(falseDemand.claimedCents),
            paid: format.money(falseDemand.lastPaid.cents),
            paidDay: format.day(falseDemand.lastPaid.day),
            alerted: format.allOf(falseDemand.alerted.map(name)),
          })}
          rule={overview.safety.rule}
          link={{ href: `${path(dashboardRoutes.bills)}#checks`, label: overview.safety.link }}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <FairnessPanel
          className="lg:col-span-2"
          title={overview.fairness.title}
          description={overview.fairness.text}
          link={{ href: path(dashboardRoutes.fairness), label: overview.fairness.link }}
          rows={givenRows(dictionary, format, memberFairness(settlement))}
          totals={[
            { label: dictionary.dashboard.fairness.members.given, value: format.money(settlement.fairness.totalContributedCents) },
            { label: dictionary.dashboard.fairness.settlement.collections, value: format.money(sumCents(settlement.plan.collections.map((each) => each.cents))) },
            { label: dictionary.dashboard.fairness.settlement.payouts, value: format.money(sumCents(settlement.plan.payouts.map((each) => each.cents))) },
          ]}
        />
        <RoseHeardPanel
          title={overview.heard.title}
          description={overview.heard.text}
          lines={roseHeard().map((line) => ({ key: line.key, day: format.day(line.day), text: overview.heard.lines[line.key], amount: format.money(line.cents) }))}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <ActivityPanel
          className="lg:col-span-2"
          title={overview.activity.title}
          link={{ href: path(dashboardRoutes.record), label: overview.activity.link }}
          items={activityItems(dictionary, format, recordEntries().slice(0, RECENT_ENTRIES))}
        />
        <div className="grid content-start gap-6">
          <SpendingPanel
            title={overview.spending.title}
            description={overview.spending.text}
            total={fill(overview.spending.total, { amount: format.money(sumCents(spending.map((row) => row.cents))) })}
            rows={spending.map((row) => ({ ...row, name: categoryName(dictionary, row.category), amount: format.money(row.cents) }))}
          />
          <ComingUpPanel
            title={overview.comingUp.title}
            link={{ href: path(dashboardRoutes.bills), label: overview.comingUp.link }}
            items={upcomingBills().map((bill) => ({
              id: `${bill.payeeId}-${bill.due}`,
              day: format.day(bill.due),
              payee: payeeName(dictionary, bill.payeeId),
              approval: common.planLabels[planLabel(bill.plan)],
              amount: format.money(bill.expectedCents),
            }))}
          />
        </div>
      </div>
    </>
  );
}
