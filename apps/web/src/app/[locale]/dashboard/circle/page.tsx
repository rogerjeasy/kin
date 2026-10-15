import { APPROVAL_WINDOW_HOURS, PARENT_LEVELS, PAUSE_HOURS, rosesMonth } from "@kin/domain";
import type { Metadata } from "next";

import { MemberList } from "@/components/dashboard/circle/member-list";
import { ParentPanel } from "@/components/dashboard/circle/parent-panel";
import { PayeeList } from "@/components/dashboard/circle/payee-list";
import { TermList } from "@/components/dashboard/circle/term-list";
import { DemoActions } from "@/components/dashboard/ui/demo-actions";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { categoryName, nameOf, payeeName } from "@/components/dashboard/words/names";
import { circlePortraits } from "@/content/circle-portraits";
import { circleFormatters } from "@/content/demo-circle/format";
import { ROSE_LEVEL, VIEWER, demoMembers } from "@/content/demo-circle/members";
import { PAYEE_IDS, demoPayees } from "@/content/demo-circle/payees";
import { dashboardMetadata } from "@/i18n/page-context";
import { dashboardContext } from "@/server/dashboard-context";
import { fill } from "@/i18n/template";

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle">): Promise<Metadata> {
  return dashboardMetadata(params, "circle");
}

const { agreement } = rosesMonth;

export default async function CirclePage({ params }: PageProps<"/[locale]/dashboard/circle">) {
  const { locale, dictionary } = await dashboardContext(params, "circle");
  const { circle, common, demoAction } = dictionary.dashboard;
  const format = circleFormatters(locale);
  const { terms } = circle.agreement;
  const careRate = agreement.care?.rateCentsPerHour;

  return (
    <>
      <PageHeader title={circle.title} lede={circle.lede} />
      <div className="grid gap-6 lg:grid-cols-3">
        <ParentPanel
          portrait={circlePortraits.rose}
          title={circle.parent.title}
          text={fill(circle.parent.text, { amount: format.money(agreement.approvals.parentDecidesAboveCents) })}
          levelsLabel={circle.parent.levelsLabel}
          currentLabel={circle.parent.current}
          levels={PARENT_LEVELS.map((level) => ({ key: level, ...circle.parent.levels[level], current: level === ROSE_LEVEL }))}
        />
        <Panel
          className="lg:col-span-2"
          title={circle.members.title}
          aside={<DemoActions actions={[{ label: circle.members.invite, variant: "outline" }]} note={demoAction} className="w-full sm:w-auto" />}
          flush
        >
          <MemberList
            members={demoMembers.map((member) => {
              const share = agreement.shares.find((each) => each.memberId === member.id);
              const name = nameOf(dictionary, member.id);
              return {
                id: member.id,
                portrait: circlePortraits[member.id],
                name: member.id === VIEWER.id ? `${name} (${common.you})` : name,
                role: common.roles[member.role],
                share: share ? fill(circle.members.share, { share: format.share(share.bps) }) : null,
                text: circle.members.roleText[member.role],
              };
            })}
          />
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={circle.agreement.title} description={fill(circle.agreement.version, { version: format.count(agreement.version) })}>
          <TermList
            terms={[
              ...(careRate === undefined ? [] : [{ label: terms.care.label, value: fill(terms.care.value, { rate: format.money(careRate) }) }]),
              { label: terms.parent.label, value: fill(terms.parent.value, { amount: format.money(agreement.approvals.parentDecidesAboveCents) }) },
              { label: terms.second.label, value: fill(terms.second.value, { amount: format.money(agreement.approvals.secondApprovalAboveCents) }) },
              { label: terms.ceiling.label, value: fill(terms.ceiling.value, { amount: format.money(agreement.approvals.ceilingCents) }) },
              { label: terms.window.label, value: fill(terms.window.value, { hours: format.count(APPROVAL_WINDOW_HOURS) }) },
              { label: terms.pause.label, value: fill(terms.pause.value, { hours: format.count(PAUSE_HOURS) }) },
            ]}
          />
        </Panel>
        <Panel title={circle.payees.title} description={circle.payees.text} flush>
          <PayeeList
            payees={PAYEE_IDS.map((id) => {
              const { category, payee } = demoPayees[id];
              const rule = payee.autoPay;
              return {
                id,
                name: payeeName(dictionary, id),
                category: categoryName(dictionary, category),
                status: { text: payee.status === "new" ? circle.payees.new : circle.payees.approved, isNew: payee.status === "new" },
                rule: rule
                  ? fill(circle.payees.standing, { min: format.money(rule.minCents), max: format.money(rule.maxCents) })
                  : circle.payees.eachBill,
              };
            })}
          />
        </Panel>
      </div>
    </>
  );
}
