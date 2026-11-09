import { APPROVAL_WINDOW_HOURS, CIRCLE_ROLES, PARENT_LEVELS, PAUSE_HOURS } from "@kin/domain";
import type { Metadata } from "next";
import { caregiverAccess } from "@kin/auth";
import { CaregiverRates } from "@/components/dashboard/caregiver-billing/caregiver-rates";

import { MonthlySharePanel } from "@/components/dashboard/monthly-shares/monthly-share-panel";
import { MemberList } from "@/components/dashboard/circle/member-list";
import { ParentPanel } from "@/components/dashboard/circle/parent-panel";
import { PayeeList } from "@/components/dashboard/circle/payee-list";
import { TermList } from "@/components/dashboard/circle/term-list";
import { InvitationList } from "@/components/dashboard/circle/invitation-list";
import { InviteSheet } from "@/components/dashboard/circle/invite-sheet";
import { EmptyPanel } from "@/components/dashboard/ui/empty-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { circleFormatters } from "@/content/circle/format";
import { activeMembers, parentOf } from "@/content/circle/members";
import { circleNames } from "@/content/circle/names";
import { demoPayeeNote } from "@/content/circle/payout-proof";
import { circleSlots } from "@/content/circle/words";
import { dashboardMetadata } from "@/i18n/page-context";
import { fill } from "@/i18n/template";
import { agreementRoute, careAgreementsRoute } from "@/content/dashboard-routes";
import { localizedPath } from "@/i18n/routing";
import { dashboardContext, may } from "@/server/dashboard-context";
import { demoPayeeOf } from "@/server/sandbox-payout";

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle">): Promise<Metadata> {
  return dashboardMetadata(params, "circle");
}

export default async function CirclePage({ params, searchParams }: PageProps<"/[locale]/dashboard/circle">) {
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "circle");
  // PayPal returns a member here after they approve a monthly share.
  const backFromPayPal = (await searchParams)["monthly"] === "back";
  const { circle: copy, common, empty } = dictionary.dashboard;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const { agreement } = circle;
  const parent = parentOf(circle);
  const { terms } = copy.agreement;
  const careRate = agreement?.care?.rateCentsPerHour;
  const slots = circleSlots(circle, format);
  const parentWords = { parent: slots.parent };
  // The agreement's own screen, for every role that may read it.
  const agreementLink = may(circle, "money.view") ? { href: localizedPath(locale, agreementRoute), label: dictionary.dashboard.agreement.open } : null;

  return (
    <>
      <PageHeader title={copy.title} lede={copy.lede} />
      {caregiverAccess({ role: circle.viewer.role, status: "active" }, "caregiver_rate.manage", viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes) ? <CaregiverRates circle={circle} copy={dictionary.dashboard.caregiverBilling} demoNote={demoPayeeNote(dictionary.sandboxPayout, demoPayeeOf(circle))} /> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        {parent ? (
          <ParentPanel
            portrait={parent.portrait}
            name={parent.displayName}
            title={fill(copy.parent.title, parentWords)}
            text={
              parent.parentLevel === "decides" && agreement
                ? fill(copy.parent.text, { ...parentWords, amount: format.money(agreement.approvals.parentDecidesAboveCents) })
                : copy.parent.levels[parent.parentLevel ?? "represented"].text
            }
            levelsLabel={copy.parent.levelsLabel}
            currentLabel={fill(copy.parent.current, parentWords)}
            levels={PARENT_LEVELS.map((level) => ({ key: level, ...copy.parent.levels[level], current: level === parent.parentLevel }))}
          />
        ) : null}
        <Panel
          className={parent ? "lg:col-span-2" : "lg:col-span-3"}
          title={copy.members.title}
          aside={
            may(circle, "member.invite") ? (
              <InviteSheet locale={locale} trigger={copy.members.invite} copy={copy.invite} roles={CIRCLE_ROLES.map((role) => ({ value: role, label: common.roles[role] }))} />
            ) : null
          }
          flush
        >
          <MemberList
            members={activeMembers(circle).map((member) => {
              const share = agreement?.shares.find((each) => each.memberId === member.id);
              const name = names.member(member.id);
              return {
                id: member.id,
                portrait: member.portrait,
                name: member.id === circle.viewer.memberId ? `${name} (${common.you})` : name,
                role: common.roles[member.role],
                share: share ? fill(copy.members.share, { share: format.share(share.bps) }) : null,
                text: copy.members.roleText[member.role],
              };
            })}
          />
        </Panel>
      </div>
      {may(circle, "care_agreement.view") ? (
        <Panel title={dictionary.dashboard.careAgreements.title} description={dictionary.dashboard.careAgreements.lede} link={{ href: localizedPath(locale, careAgreementsRoute), label: dictionary.dashboard.careAgreements.link }}>
          <p className="text-sm text-muted-foreground">{fill(dictionary.dashboard.careAgreements.summary, { count: format.count(circle.careAgreements.filter((each) => each.status !== "withdrawn").length) })}</p>
        </Panel>
      ) : null}
      <MonthlySharePanel locale={locale} dictionary={dictionary} circle={circle} checkOnLoad={backFromPayPal} />
      {circle.invitations.length > 0 ? (
        <Panel title={copy.invitations.title} flush>
          <InvitationList
            items={circle.invitations.map((invitation) => ({
              id: invitation.id,
              email: invitation.email,
              role: common.roles[invitation.role],
              status: copy.invitations.status[invitation.status],
              pending: invitation.status === "pending",
              detail: invitation.status === "pending" ? fill(copy.invitations.waiting, { date: format.dateTime(invitation.expiresAt) }) : "",
            }))}
          />
        </Panel>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        {agreement ? (
          <Panel title={copy.agreement.title} description={fill(copy.agreement.version, { version: format.count(agreement.version) })} link={agreementLink ?? undefined}>
            <TermList
              terms={[
                ...(careRate === undefined ? [] : [{ label: terms.care.label, value: fill(terms.care.value, { rate: format.money(careRate) }) }]),
                { label: fill(terms.parent.label, parentWords), value: fill(terms.parent.value, { amount: format.money(agreement.approvals.parentDecidesAboveCents) }) },
                { label: terms.second.label, value: fill(terms.second.value, { amount: format.money(agreement.approvals.secondApprovalAboveCents) }) },
                { label: terms.ceiling.label, value: fill(terms.ceiling.value, { amount: format.money(agreement.approvals.ceilingCents) }) },
                { label: terms.window.label, value: fill(terms.window.value, { hours: format.count(APPROVAL_WINDOW_HOURS) }) },
                { label: terms.pause.label, value: fill(terms.pause.value, { hours: format.count(PAUSE_HOURS) }) },
              ]}
            />
          </Panel>
        ) : (
          <EmptyPanel title={copy.agreement.title} text={empty.agreement} link={agreementLink ?? undefined} />
        )}
        {circle.payees.length > 0 ? (
          <Panel title={copy.payees.title} description={copy.payees.text} flush>
            <PayeeList
              payees={circle.payees.map(({ id, category, payee }) => {
                const rule = payee.autoPay;
                return {
                  id,
                  name: names.payee(id),
                  category: names.category(category),
                  status: { text: payee.status === "new" ? copy.payees.new : copy.payees.approved, isNew: payee.status === "new" },
                  rule: rule ? fill(copy.payees.standing, { min: format.money(rule.minCents), max: format.money(rule.maxCents) }) : copy.payees.eachBill,
                };
              })}
            />
          </Panel>
        ) : (
          <EmptyPanel title={copy.payees.title} description={copy.payees.text} text={empty.payees} />
        )}
      </div>
    </>
  );
}
