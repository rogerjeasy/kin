import type { Metadata } from "next";
import { ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { sumCents } from "@kin/domain";

import { ActivityPanel } from "@/components/dashboard/overview/activity-panel";
import { AgreementPrompt } from "@/components/dashboard/overview/agreement-prompt";
import { AttentionPanel } from "@/components/dashboard/overview/attention-panel";
import { ComingUpPanel } from "@/components/dashboard/overview/coming-up-panel";
import { FairnessPanel } from "@/components/dashboard/overview/fairness-panel";
import { RoseHeardPanel } from "@/components/dashboard/overview/rose-heard-panel";
import { SafetyPanel } from "@/components/dashboard/overview/safety-panel";
import { SpendingPanel } from "@/components/dashboard/overview/spending-panel";
import { TopUpAction } from "@/components/dashboard/top-up/top-up-action";
import { StatRow } from "@/components/dashboard/overview/stat-row";
import { EmptyPanel } from "@/components/dashboard/ui/empty-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { activityItems } from "@/components/dashboard/words/activity-items";
import { attentionItems } from "@/components/dashboard/words/attention-items";
import { givenRows } from "@/components/dashboard/words/given-rows";
import { planLabel } from "@/components/dashboard/words/plan-words";
import { ButtonLink } from "@/components/shared/button-link";
import { Button } from "@/components/ui/button";
import { agreementRoute, dashboardRoutes, listenRoute } from "@/content/dashboard-routes";
import { memberFairness, periodSettlement } from "@/content/circle/fairness";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { openPeriod } from "@/content/circle/period";
import { waitingProposals } from "@/content/circle/proposal-view";
import { monthTotals, recordEntries, spendingByCategory } from "@/content/circle/record";
import { latestClaimCheck, parentHeard } from "@/content/circle/safety";
import { upcomingBills } from "@/content/circle/upcoming";
import { circleSlots } from "@/content/circle/words";
import { dashboardMetadata } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { dashboardContext } from "@/server/dashboard-context";

const RECENT_ENTRIES = 8;

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard">): Promise<Metadata> {
  return dashboardMetadata(params, "overview");
}

export default async function OverviewPage({ params }: PageProps<"/[locale]/dashboard">) {
  const { locale, dictionary, viewer, circle } = await dashboardContext(params, "overview");
  const { overview, common, empty } = dictionary.dashboard;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const path = (route: string) => localizedPath(locale, route);
  const period = openPeriod(circle);
  const slots = circleSlots(circle, format);
  const { month } = slots;
  const greeted = viewer.kind === "person" ? viewer.session.name : names.member(circle.viewer.memberId);
  const portraits = new Map(circle.members.map((member) => [member.id, member.portrait]));

  const totals = monthTotals(circle, period);
  const waiting = waitingProposals(circle);
  const spending = spendingByCategory(circle, period);
  const settlement = periodSettlement(circle, period);
  const fairness = settlement ? memberFairness(settlement, circle) : [];
  const contributors = fairness.filter((member) => member.input.paidInCents > 0);
  const check = latestClaimCheck(circle);
  const heard = parentHeard(circle);
  const activity = recordEntries(circle).slice(0, RECENT_ENTRIES);
  const upcoming = upcomingBills(circle);
  // The newest version, when it waits for this viewer: they share its cost and have not accepted.
  const newest = circle.agreementVersions.at(-1);
  const awaitsMe = newest?.status === "awaiting" && newest.waitingFor.includes(circle.viewer.memberId) ? newest : null;

  return (
    <>
      <PageHeader
        eyebrow={format.longDay(circle.circle.now)}
        title={fill(overview.greeting, { name: greeted })}
        lede={fill(overview.lede, slots)}
        actions={
          <>
            <TopUpAction locale={locale} dictionary={dictionary} circle={circle} />
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
        label={fill(overview.stats.label, slots)}
        pool={{ label: overview.stats.pool.label, value: format.money(totals.poolCents), note: overview.stats.pool.note }}
        paidIn={{
          label: overview.stats.paidIn.label,
          value: format.money(totals.paidInCents),
          note:
            contributors.length > 0
              ? fill(overview.stats.paidIn.note, { names: format.allOf(contributors.map((member) => names.member(member.memberId))) })
              : overview.stats.paidIn.none,
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
      {awaitsMe ? (
        <AgreementPrompt href={path(agreementRoute)} text={fill(dictionary.dashboard.agreement.attention, { version: format.count(awaitsMe.version) })} label={dictionary.dashboard.agreement.open} />
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        {waiting.length > 0 ? (
          <AttentionPanel
            className="lg:col-span-2"
            title={overview.attention.title}
            link={{ href: path(dashboardRoutes.approvals), label: overview.attention.link }}
            items={attentionItems(locale, dictionary, names, format, waiting, month)}
          />
        ) : (
          <EmptyPanel className="lg:col-span-2" title={overview.attention.title} text={empty.attention} />
        )}
        {check && check.claimedCents !== null && check.lastPaid ? (
          <SafetyPanel
            title={overview.safety.title}
            text={fill(overview.safety.text, {
              parent: slots.parent,
              payee: check.payeeId === null ? "" : names.payee(check.payeeId),
              claimed: format.money(check.claimedCents),
              paid: format.money(check.lastPaid.cents),
              paidDay: format.day(check.lastPaid.day),
              alerted: format.allOf(check.alerted.map(names.member)),
            })}
            rule={overview.safety.rule}
            link={{ href: `${path(dashboardRoutes.bills)}#checks`, label: overview.safety.link }}
          />
        ) : (
          <EmptyPanel title={empty.safety.title} text={empty.safety.text} icon={ShieldCheckIcon} />
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {settlement && fairness.length > 0 ? (
          <FairnessPanel
            className="lg:col-span-2"
            title={fill(overview.fairness.title, slots)}
            description={overview.fairness.text}
            link={{ href: path(dashboardRoutes.fairness), label: overview.fairness.link }}
            rows={givenRows(dictionary, names, format, fairness, (id) => portraits.get(id) ?? null)}
            totals={[
              { label: dictionary.dashboard.fairness.members.given, value: format.money(settlement.fairness.totalContributedCents) },
              { label: dictionary.dashboard.fairness.settlement.collections, value: format.money(sumCents(settlement.plan.collections.map((each) => each.cents))) },
              { label: dictionary.dashboard.fairness.settlement.payouts, value: format.money(sumCents(settlement.plan.payouts.map((each) => each.cents))) },
            ]}
          />
        ) : (
          <EmptyPanel className="lg:col-span-2" title={fill(overview.fairness.title, slots)} text={empty.fairness} />
        )}
        {heard.length > 0 ? (
          <RoseHeardPanel
            title={fill(overview.heard.title, slots)}
            description={fill(overview.heard.text, slots)}
            link={{ href: path(listenRoute), label: dictionary.dashboard.listen.link }}
            lines={heard.map((line) => ({
              key: line.id,
              day: format.day(line.day),
              // {amount} stays a slot, so the panel can speak it in its own style.
              text: fill(overview.heard.lines[line.topic], { payee: names.subject(line.subject), amount: "{amount}" }),
              amount: format.money(line.cents),
            }))}
          />
        ) : (
          <EmptyPanel title={fill(overview.heard.title, slots)} text={fill(empty.heard, slots)} />
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {activity.length > 0 ? (
          <ActivityPanel
            className="lg:col-span-2"
            title={overview.activity.title}
            link={{ href: path(dashboardRoutes.record), label: overview.activity.link }}
            items={activityItems(dictionary, names, format, activity)}
          />
        ) : (
          <EmptyPanel className="lg:col-span-2" title={overview.activity.title} text={empty.activity} />
        )}
        <div className="grid content-start gap-6">
          {spending.length > 0 ? (
            <SpendingPanel
              title={overview.spending.title}
              description={fill(overview.spending.text, slots)}
              total={fill(overview.spending.total, { amount: format.money(sumCents(spending.map((row) => row.cents))) })}
              rows={spending.map((row) => ({ ...row, name: names.category(row.category), amount: format.money(row.cents) }))}
            />
          ) : (
            <EmptyPanel title={overview.spending.title} text={empty.spending} />
          )}
          {upcoming.length > 0 ? (
            <ComingUpPanel
              title={overview.comingUp.title}
              link={{ href: path(dashboardRoutes.bills), label: overview.comingUp.link }}
              items={upcoming.map((bill) => ({
                id: bill.id,
                day: format.day(bill.due),
                payee: names.payee(bill.payeeId),
                approval: bill.plan ? fill(common.planLabels[planLabel(bill.plan)], slots) : "",
                amount: format.money(bill.expectedCents),
              }))}
            />
          ) : (
            <EmptyPanel title={overview.comingUp.title} text={empty.comingUp} />
          )}
        </div>
      </div>
    </>
  );
}
