import { agreementChanges, calendarDay } from "@kin/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AcceptButton } from "@/components/dashboard/agreement/accept-button";
import { AcceptanceList } from "@/components/dashboard/agreement/acceptance-list";
import { AgreementForm } from "@/components/dashboard/agreement/agreement-form";
import { AgreementTermsPanel } from "@/components/dashboard/agreement/agreement-terms-panel";
import { ApprovalExamples } from "@/components/dashboard/agreement/approval-examples";
import { PendingVersionPanel } from "@/components/dashboard/agreement/pending-version-panel";
import { VersionHistory } from "@/components/dashboard/agreement/version-history";
import { Button } from "@/components/ui/button";
import { EmptyPanel } from "@/components/dashboard/ui/empty-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { changeWords } from "@/components/dashboard/words/agreement-words";
import { acceptanceView, examplesView, historyView, initialDraft, statusWords, termsView, type AgreementWords } from "@/content/circle/agreement-view";
import { circleFormatters } from "@/content/circle/format";
import { parentLevelOf } from "@/content/circle/members";
import { circleNames } from "@/content/circle/names";
import { circleSlots } from "@/content/circle/words";
import { agreementRoute, dashboardRoutes } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { sharingMembers } from "@/server/agreement";
import { dashboardContext, may } from "@/server/dashboard-context";


export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle/agreement">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, lede } = dictionary.dashboard.agreement;
  return { title, description: lede, robots: { index: false, follow: false } };
}

export default async function AgreementPage({ params }: PageProps<"/[locale]/dashboard/circle/agreement">) {
  const { locale, dictionary, circle } = await dashboardContext(params, "circle");
  // A caregiver never reads the agreement: the circle screen is theirs instead.
  if (!may(circle, "money.view")) redirect(localizedPath(locale, dashboardRoutes.circle));
  const copy = dictionary.dashboard.agreement;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const parent = circleSlots(circle, format).parent;
  const words: AgreementWords = { copy, methods: dictionary.dashboard.approvals.slots.methods, planLabels: dictionary.dashboard.common.planLabels, names, format, parent };
  const versions = circle.agreementVersions;
  const inForce = versions.find((version) => version.status === "in_force") ?? null;
  const newest = versions.at(-1) ?? null;
  const pending = newest !== null && (newest.status === "awaiting" || newest.status === "scheduled") ? newest : null;
  const sharing = sharingMembers(circle);
  const me = circle.viewer.memberId;
  const canAccept = may(circle, "agreement.accept");

  return (
    <>
      <PageHeader
        title={copy.title}
        lede={copy.lede}
        actions={
          inForce ? (
            <Button asChild variant="outline" className="min-h-11">
              <Link href={localizedPath(locale, `${agreementRoute}/simulate`)}>{dictionary.dashboard.simulator.link}</Link>
            </Button>
          ) : null
        }
      />
      {pending ? (
        <PendingVersionPanel
          title={fill(copy.pendingTitle, { version: format.count(pending.version) })}
          text={fill(pending.status === "scheduled" ? copy.scheduledText : copy.pendingText, { day: format.dateTime(pending.proposedAt), start: format.day(pending.effectiveOn) })}
          status={{ text: statusWords(words, pending), tone: pending.status === "scheduled" ? "positive" : "waiting" }}
          changesTitle={copy.changesTitle}
          noChanges={copy.noChanges}
          changes={agreementChanges(circle.agreement, pending).map((change) => changeWords(copy, names.member, format, parent, change))}
          acceptedTitle={copy.acceptedTitle}
          acceptances={acceptanceView(words, pending)}
          action={
            pending.acceptances.some((each) => each.memberId === me) ? (
              <p className="text-sm text-positive">{copy.youAccepted}</p>
            ) : canAccept && pending.status === "awaiting" ? (
              <AcceptButton agreementId={pending.id} label={fill(copy.accept, { version: format.count(pending.version) })} pendingLabel={copy.accepting} errors={copy.errors} />
            ) : null
          }
        />
      ) : null}
      {inForce ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <AgreementTermsPanel locale={locale} title={fill(copy.inForce, { version: format.count(inForce.version), day: format.day(inForce.effectiveOn) })} description={copy.termsTitle} sharesTitle={copy.sharesTitle} {...termsView(words, inForce, parentLevelOf(circle) === "decides")}>
            <AcceptanceList title={copy.acceptedTitle} items={acceptanceView(words, inForce)} />
          </AgreementTermsPanel>
          <ApprovalExamples title={copy.examplesTitle} description={copy.examplesText} items={examplesView(words, circle, inForce)} />
        </div>
      ) : (
        <EmptyPanel title={copy.noneTitle} text={may(circle, "agreement.propose") ? copy.noneOrganizer : copy.noneOther} />
      )}
      {may(circle, "agreement.propose") ? (
        <AgreementForm
          locale={locale}
          currency={circle.circle.currency}
          copy={copy}
          members={sharing.map((id) => ({ id, name: names.member(id) }))}
          names={Object.fromEntries(circle.members.map((member) => [member.id, names.member(member.id)]))}
          parent={parent}
          first={inForce === null}
          nextVersion={(newest?.version ?? 0) + 1}
          today={calendarDay(circle.circle.now, circle.circle.timezone).occurredOn}
          initial={initialDraft(circle, sharing)}
        />
      ) : null}
      {versions.length > 0 ? <VersionHistory title={copy.historyTitle} items={historyView(words, versions)} /> : null}
    </>
  );
}
