import { careAgreementClauses, coveredFrom, replacedBy } from "@kin/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AgreementCard } from "@/components/dashboard/care-agreements/agreement-card";
import { CareAgreementForm } from "@/components/dashboard/care-agreements/care-agreement-form";
import { EmptyPanel } from "@/components/dashboard/ui/empty-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { circleFormatters } from "@/content/circle/format";
import { circleToday } from "@/content/circle/today";
import { dashboardRoutes, packetRoute } from "@/content/dashboard-routes";
import { Button } from "@/components/ui/button";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { agreementNames } from "@/server/care-agreement";
import { dashboardContext, may } from "@/server/dashboard-context";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle/care-agreements">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.dashboard.meta.careAgreements;
  return { title, description, robots: { index: false, follow: false } };
}

export default async function CareAgreementsPage({ params }: PageProps<"/[locale]/dashboard/circle/care-agreements">) {
  const { locale, dictionary, circle } = await dashboardContext(params, "circle");
  if (!may(circle, "care_agreement.view")) redirect(localizedPath(locale, dashboardRoutes.circle));
  const copy = dictionary.dashboard.careAgreements;
  const format = circleFormatters(locale, circle);
  const today = circleToday(circle);
  const memberName = (id: string) => circle.members.find((member) => member.id === id)?.displayName ?? id;
  const organizer = may(circle, "care_agreement.propose");
  const canSign = may(circle, "care_agreement.sign");
  // Only a caregiver with a pay rate can have an agreement: it states that rate.
  const caregivers = circle.payees.flatMap((payee) =>
    payee.payee.member?.role === "caregiver" && payee.caregiverRateCentsPerHour !== null ? [{ payeeId: payee.id, name: payee.name, rate: format.money(payee.caregiverRateCentsPerHour) }] : [],
  );
  const me = circle.viewer.memberId;
  const agreements = circle.careAgreements.toReversed();
  const allFacts = circle.careAgreements.map((agreement) => agreement.facts);
  const payRateOf = (payeeId: string) => circle.payees.find((payee) => payee.id === payeeId)?.caregiverRateCentsPerHour ?? null;

  return (
    <>
      <PageHeader
        title={copy.title}
        lede={copy.lede}
        actions={
          may(circle, "money.view") ? (
            <Button asChild variant="outline" className="h-auto min-h-11 w-full py-2 text-wrap sm:w-auto">
              <Link href={localizedPath(locale, packetRoute)}>{dictionary.dashboard.packet.link}</Link>
            </Button>
          ) : null
        }
      />
      <p className="rounded-xl border bg-secondary/40 p-3 text-sm text-pretty">{copy.notice}</p>
      {agreements.length === 0 ? <EmptyPanel title={copy.title} text={copy.empty} /> : null}
      {agreements.map((agreement) => {
        const terms = { payeeId: agreement.payeeId, caregiverMemberId: agreement.caregiverMemberId, caregiverRelation: agreement.caregiverRelation, duties: agreement.duties, weeklyMinutes: agreement.weeklyMinutes, rateCentsPerHour: agreement.rateCentsPerHour, startsOn: agreement.startsOn, endTerm: agreement.endTerm, endsOn: agreement.endsOn, payer: agreement.payer, state: agreement.usState };
        const names = agreementNames(circle, terms);
        const signed = (capacity: "caregiver" | "recipient") => agreement.signatures.some((signature) => (capacity === "caregiver" ? signature.capacity === "caregiver" : signature.capacity !== "caregiver"));
        const draft = agreement.status === "draft";
        const mine = agreement.caregiverMemberId === me;
        const replacement = replacedBy(agreement.facts, allFacts);
        const payRate = payRateOf(agreement.payeeId);
        const governs = agreement.status === "active" || agreement.status === "scheduled";
        return (
          <AgreementCard
            key={agreement.id}
            copy={copy}
            agreement={agreement}
            caregiver={names.caregiver}
            signers={agreement.signatures.map((signature) => ({ name: memberName(signature.memberId), capacity: signature.capacity, day: signature.signedOn }))}
            clauses={careAgreementClauses(terms, names)}
            rate={format.money(agreement.rateCentsPerHour)}
            replacedFrom={replacement === null ? null : coveredFrom(replacement)}
            movedPayRate={governs && payRate !== null && payRate !== agreement.rateCentsPerHour ? format.money(payRate) : null}
            format={format}
            today={today}
            can={{
              sign: canSign && draft && !agreement.signatures.some((signature) => signature.memberId === me) && (circle.viewer.role === "caregiver" ? mine && !signed("caregiver") : !signed("recipient")),
              withdraw: organizer && draft,
              end: organizer && (agreement.status === "active" || agreement.status === "scheduled"),
            }}
          />
        );
      })}
      {organizer ? caregivers.length > 0 ? <CareAgreementForm copy={copy} caregivers={caregivers} today={today} /> : <EmptyPanel title={copy.form.title} text={copy.noCaregiver} /> : null}
    </>
  );
}
