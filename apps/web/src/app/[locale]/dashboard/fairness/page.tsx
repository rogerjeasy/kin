import { rosesMonth } from "@kin/domain";
import type { Metadata } from "next";

import { MemberCard } from "@/components/dashboard/fairness/member-card";
import { SettlementPanel } from "@/components/dashboard/fairness/settlement-panel";
import { GivenBars } from "@/components/dashboard/ui/given-bars";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { givenRows, positionStatus } from "@/components/dashboard/words/given-rows";
import { isMember, nameOf } from "@/components/dashboard/words/names";
import { ShareBar } from "@/components/shared/share-bar";
import { ShareLegend } from "@/components/shared/share-legend";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { memberFairness, monthSettlement } from "@/content/demo-circle/fairness";
import { circleFormatters } from "@/content/demo-circle/format";
import { dashboardMetadata } from "@/i18n/page-context";
import { dashboardContext } from "@/server/dashboard-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard/fairness">): Promise<Metadata> {
  return dashboardMetadata(params, "fairness");
}

export default async function FairnessPage({ params }: PageProps<"/[locale]/dashboard/fairness">) {
  const { locale, dictionary } = await dashboardContext(params, "fairness");
  const { fairness } = dictionary.dashboard;
  const { members: copy, settlement: settle } = fairness;
  const format = circleFormatters(locale);
  const settlement = monthSettlement();
  const members = memberFairness(settlement);
  const name = (id: string) => (isMember(id) ? nameOf(dictionary, id) : id);
  const careRate = rosesMonth.agreement.care?.rateCentsPerHour;

  return (
    <>
      <PageHeader title={fairness.title} lede={fairness.lede} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title={fairness.agreement.title}>
          <ShareBar label={fairness.agreement.title} />
          <div className="mt-4">
            <ShareLegend locale={locale} people={dictionary.common.people} align="start" />
          </div>
          <div className="mt-5 space-y-2 border-t pt-4 text-sm text-pretty text-muted-foreground">
            {careRate === undefined ? null : <p>{fill(fairness.agreement.care, { rate: format.money(careRate) })}</p>}
            <p>{fill(fairness.agreement.version, { version: format.count(rosesMonth.agreement.version) })}</p>
          </div>
        </Panel>
        <Panel
          className="lg:col-span-2"
          title={fairness.chart.title}
          description={fill(fairness.chart.text, { total: format.money(settlement.fairness.totalContributedCents) })}
        >
          <GivenBars rows={givenRows(dictionary, format, members)} />
        </Panel>
      </div>
      <section aria-labelledby="members-heading" className="space-y-4">
        <h2 id="members-heading" className="text-lg font-semibold">
          {copy.title}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {members.map(({ memberId, shareBps, input, position }) => (
            <MemberCard
              key={memberId}
              memberId={memberId}
              name={name(memberId)}
              share={format.share(shareBps)}
              lines={[
                { label: copy.paidIn, value: format.money(input.paidInCents) },
                { label: copy.ownPocket, value: format.money(input.outOfPocketCents) },
                { label: copy.care, value: format.money(input.careCreditCents) },
                { label: copy.given, value: format.money(position.contributedCents), strong: true },
                { label: copy.target, value: format.money(position.targetCents) },
              ]}
              position={positionStatus(format, position.positionCents, copy, name(memberId))}
              explanation={[
                fill(copy.explain, { name: name(memberId), given: format.money(position.contributedCents), target: format.money(position.targetCents) }),
                input.outOfPocketCents > 0 ? fill(copy.reasons.ownPocket, { name: name(memberId), amount: format.money(input.outOfPocketCents) }) : null,
                input.careCreditCents > 0 ? fill(copy.reasons.care, { amount: format.money(input.careCreditCents) }) : null,
              ]
                .filter((sentence) => sentence !== null)
                .join(" ")}
            />
          ))}
        </div>
      </section>
      <SettlementPanel
        title={settle.title}
        description={settle.text}
        status={settle.status}
        core={settle.core}
        link={{ href: localizedPath(locale, dashboardRoutes.approvals), label: settle.link }}
        groups={[
          {
            title: settle.payouts,
            direction: "out",
            items: settlement.plan.payouts.map((payout) => ({
              id: payout.memberId,
              who: fill(settle.payout, { name: name(payout.memberId) }),
              amount: format.money(payout.cents),
              detail: `${settle.now} ${format.money(payout.releasableCents)} · ${fill(settle.fee, { fee: format.money(payout.feeReservedCents) })}`,
            })),
          },
          {
            title: settle.collections,
            direction: "in",
            items: settlement.plan.collections.map((collection) => ({
              id: collection.memberId,
              who: fill(settle.collection, { name: name(collection.memberId) }),
              amount: format.money(collection.cents),
              detail: settle.invoice,
            })),
          },
        ]}
      />
    </>
  );
}
