import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BillRehearsal } from "@/components/dashboard/simulator/bill-rehearsal";
import { MemberComparison } from "@/components/dashboard/simulator/member-comparison";
import { SimulationBanner } from "@/components/dashboard/simulator/simulation-banner";
import { SimulatorForm } from "@/components/dashboard/simulator/simulator-form";
import { ChangeList } from "@/components/dashboard/agreement/change-list";
import { SettlementPanel } from "@/components/dashboard/fairness/settlement-panel";
import { EmptyPanel } from "@/components/dashboard/ui/empty-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { changeWords } from "@/components/dashboard/words/agreement-words";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { circleSlots } from "@/content/circle/words";
import { currentShareText, inputFromQuery, simulate } from "@/content/circle/simulation";
import { billWords, comparisonRows } from "@/content/circle/simulation-view";
import { agreementRoute, dashboardRoutes } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { dashboardContext, may } from "@/server/dashboard-context";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle/agreement/simulate">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, lede } = dictionary.dashboard.simulator;
  return { title, description: lede, robots: { index: false, follow: false } };
}

/**
 * A rehearsal of the family agreement: the typed what-if runs through the
 * money core's own functions on a copy of today's state. It saves nothing,
 * proposes nothing and moves no money.
 */
export default async function SimulatePage({ params, searchParams }: PageProps<"/[locale]/dashboard/circle/agreement/simulate">) {
  const { locale, dictionary, circle } = await dashboardContext(params, "circle");
  if (!may(circle, "money.view")) redirect(localizedPath(locale, dashboardRoutes.circle));
  const copy = dictionary.dashboard.simulator;
  const settle = dictionary.dashboard.fairness.settlement;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const slots = circleSlots(circle, format);
  const words = { dictionary, names, format, parent: slots.parent };
  const here = localizedPath(locale, `${agreementRoute}/simulate`);
  const header = <PageHeader title={copy.title} lede={copy.lede} />;
  const agreement = circle.agreement;
  if (agreement === null) {
    return (
      <>
        {header}
        <EmptyPanel title={copy.title} text={dictionary.dashboard.empty.fairness} link={{ href: localizedPath(locale, agreementRoute), label: copy.back }} />
      </>
    );
  }

  const { asked, input } = inputFromQuery(await searchParams);
  const outcome = asked ? simulate(circle, input) : { kind: "idle" as const };
  const result = outcome.kind === "ran" ? outcome.result : null;
  const members = agreement.shares.map((share) => ({ id: share.memberId, name: names.member(share.memberId), share: input.shares[share.memberId] ?? currentShareText(circle)[share.memberId] ?? "" }));
  const movements = (group: "payouts" | "collections") =>
    result === null
      ? []
      : group === "payouts"
        ? result.after.plan.payouts.map((payout) => ({ id: payout.memberId, who: fill(settle.payout, { name: names.member(payout.memberId) }), amount: format.money(payout.cents), detail: `${settle.now} ${format.money(payout.releasableCents)} · ${fill(settle.fee, { fee: format.money(payout.feeReservedCents) })}` }))
        : result.after.plan.collections.map((collection) => ({ id: collection.memberId, who: fill(settle.collection, { name: names.member(collection.memberId) }), amount: format.money(collection.cents), detail: settle.invoice }));

  return (
    <>
      {header}
      <SimulationBanner badge={copy.badge} text={copy.banner} />
      <SimulatorForm copy={copy} currency={circle.circle.currency} resetHref={here} members={members} leaving={input.leaving} bill={input.bill} />
      {outcome.kind === "failed" ? (
        <p role="alert" className="text-sm text-danger">
          {copy.errors[outcome.reason]}
        </p>
      ) : null}
      {result === null ? null : (
        <>
          <div className="rounded-2xl border bg-card p-5 sm:p-6">
            <ChangeList title={copy.changesTitle} empty={copy.noChanges} changes={result.changes.map((change) => changeWords(dictionary.dashboard.agreement, names.member, format, slots.parent, change))} />
          </div>
          {result.bill === null ? null : <BillRehearsal {...billWords(words, result.bill)} />}
          <MemberComparison title={copy.membersTitle} nowLabel={copy.now} simulatedLabel={copy.simulated} rows={comparisonRows(words, circle, result)} />
          <SettlementPanel
            title={fill(copy.settlementTitle, slots)}
            description={copy.settlementText}
            status={copy.badge}
            core={settle.core}
            link={{ href: localizedPath(locale, agreementRoute), label: copy.back }}
            groups={[
              { title: settle.payouts, direction: "out", items: movements("payouts") },
              { title: settle.collections, direction: "in", items: movements("collections") },
            ]}
          />
        </>
      )}
    </>
  );
}
