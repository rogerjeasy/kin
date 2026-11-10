import { ShieldCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import { VisitPreview } from "@/components/dashboard/ai/visit-preview";
import { CaregiverBills } from "@/components/dashboard/caregiver-billing/caregiver-bills";

import { ChecksPanel } from "@/components/dashboard/bills/checks-panel";
import { LettersSection } from "@/components/dashboard/letters/letters-section";
import { OfficeLineLink } from "@/components/dashboard/office-line/office-line-link";
import { officeLineRoute } from "@/content/dashboard-routes";
import { localizedPath } from "@/i18n/routing";
import { PayeeCell } from "@/components/dashboard/bills/payee-cell";
import { SandboxPayoutProof } from "@/components/dashboard/payouts/sandbox-payout-proof";
import { DataTable } from "@/components/dashboard/ui/data-table";
import { EmptyPanel } from "@/components/dashboard/ui/empty-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { checkWords } from "@/components/dashboard/words/check-words";
import { planLabel } from "@/components/dashboard/words/plan-words";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { openPeriod } from "@/content/circle/period";
import { demoPayeeNote } from "@/content/circle/payout-proof";
import { moneyKind } from "@/content/circle/provenance";
import { paidBills } from "@/content/circle/record";
import { latestClaimCheck } from "@/content/circle/safety";
import { upcomingBills, upcomingMonth } from "@/content/circle/upcoming";
import { circleSlots } from "@/content/circle/words";
import { dashboardMetadata } from "@/i18n/page-context";
import { fill } from "@/i18n/template";
import { dashboardContext, may } from "@/server/dashboard-context";
import { structuredModel } from "@/server/model";
import { demoPayeeOf, payoutProofsOf } from "@/server/sandbox-payout";
import { speechServices } from "@/server/speech";

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard/bills">): Promise<Metadata> {
  return dashboardMetadata(params, "bills");
}

export default async function BillsPage({ params }: PageProps<"/[locale]/dashboard/bills">) {
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "bills");
  const { bills, common, empty } = dictionary.dashboard;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const period = openPeriod(circle);
  const slots = circleSlots(circle, format);
  const upcoming = upcomingBills(circle);
  const paidThisMonth = paidBills(circle).filter((bill) => bill.paidOn.startsWith(`${period}-`));
  // A demo payout PayPal's sandbox made carries PayPal's own batch and item, found by the item the ledger names.
  const { byItem: proofs, byProposal } = circle.circle.demo ? await payoutProofsOf(viewer, circle.circle.id) : { byItem: new Map<string, never>(), byProposal: new Map<string, never>() };
  const dueMonth = upcomingMonth(upcoming);
  const upcomingTitle = dueMonth === null ? dictionary.dashboard.overview.comingUp.title : fill(bills.upcoming.title, { month: format.month(dueMonth) });
  const paidTitle = fill(bills.paid.title, { month: format.month(period) });
  // Only rows PayPal's record stands behind are said to be confirmed by it.
  const paidText = { paypal: bills.paid.text, simulated: bills.paid.simulatedText, mixed: bills.paid.mixedText }[moneyKind(paidThisMonth, circle.circle.demo)];
  const { columns: up } = bills.upcoming;
  const { columns: paid } = bills.paid;
  // The latest demand Kin checked, whatever it found: one that matches nothing on record matters most.
  const latest = may(circle, "safety.view") ? latestClaimCheck(circle) : null;
  const check = latest ? checkWords({ dictionary, names, format, parent: slots.parent }, latest, "bills") : null;

  const upcomingTable = (
    <DataTable
      caption={upcomingTitle}
      primary="payee"
      columns={[
        { key: "payee", header: up.payee },
        { key: "due", header: up.due },
        { key: "approval", header: up.approval },
        { key: "amount", header: up.amount, align: "end" },
      ]}
      rows={upcoming.map((bill) => ({
        id: bill.id,
        cells: {
          payee: <PayeeCell name={names.payee(bill.payeeId)} detail={names.category(bill.category)} />,
          due: format.day(bill.due),
          approval: bill.plan ? fill(common.planLabels[planLabel(bill.plan)], slots) : "",
          amount: format.money(bill.expectedCents),
        },
      }))}
    />
  );
  const paidTable = (
    <DataTable
      caption={paidTitle}
      primary="payee"
      columns={[
        { key: "payee", header: paid.payee },
        { key: "approved", header: paid.approved },
        { key: "paid", header: paid.paid },
        { key: "fee", header: paid.fee, align: "end" },
        { key: "amount", header: paid.amount, align: "end" },
      ]}
      rows={paidThisMonth.map((bill) => {
        const proof = bill.simulated ? undefined : proofs.get(bill.reference);
        return {
        id: bill.id,
        cells: {
          payee: (
            <PayeeCell
              name={names.payee(bill.payeeId)}
              detail={bill.category ? names.category(bill.category) : undefined}
              // A simulated payment has no PayPal record behind it, so it never claims PayPal's confirmation.
              tags={bill.simulated ? [common.simulated] : proof ? [dictionary.sandboxPayout.tag, common.confirmed] : [common.confirmed]}
            >
              {proof ? <SandboxPayoutProof proof={proof} copy={dictionary.sandboxPayout} /> : null}
            </PayeeCell>
          ),
          approved: bill.approvedOn ? format.day(bill.approvedOn) : "",
          paid: format.day(bill.paidOn),
          fee: format.money(bill.feeCents),
          amount: format.money(bill.cents),
        },
        };
      })}
    />
  );

  return (
    <>
      <PageHeader title={bills.title} lede={bills.lede} />
      <CaregiverBills circle={circle} viewer={viewer} locale={locale} canDescribe={structuredModel() !== null} speech={speechServices() === null ? null : dictionary.dashboard.speech} copy={dictionary.dashboard.caregiverBilling} ai={dictionary.aiProvenance} demoNote={demoPayeeNote(dictionary.sandboxPayout, demoPayeeOf(circle))} sandbox={{ paid: new Set(byProposal.keys()), tag: dictionary.sandboxPayout.tag }} />
      {may(circle, "safety.view") ? (
        <LettersSection circle={circle} locale={locale} copy={dictionary.dashboard.letters} ai={dictionary.aiProvenance} speech={speechServices() === null ? null : dictionary.dashboard.speech} canReadPhotos={structuredModel() !== null} offerSample={circle.circle.demo} mayAct={may(circle, "letter.read")} />
      ) : null}
      {circle.circle.demo && may(circle, "letter.read") && structuredModel() !== null ? <VisitPreview locale={locale} copy={dictionary.aiProvenance} billing={dictionary.dashboard.caregiverBilling} /> : null}
      {may(circle, "safety.view") ? <OfficeLineLink href={localizedPath(locale, officeLineRoute)} title={dictionary.dashboard.officeLine.title} text={dictionary.dashboard.officeLine.linkText} label={dictionary.dashboard.officeLine.link} /> : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {upcoming.length > 0 ? (
          <Panel title={upcomingTitle} description={bills.upcoming.text} flush>
            {upcomingTable}
          </Panel>
        ) : (
          <EmptyPanel title={upcomingTitle} description={bills.upcoming.text} text={empty.comingUp} />
        )}
        {check ? (
          <ChecksPanel title={bills.checks.title} description={bills.checks.text} demand={check} passed={[bills.checks.noDuplicates, bills.checks.noJumps]} />
        ) : may(circle, "safety.view") ? (
          <EmptyPanel title={empty.safety.title} text={empty.safety.text} icon={ShieldCheckIcon} />
        ) : null}
      </div>
      {paidThisMonth.length > 0 ? (
        <Panel title={paidTitle} description={paidText} flush>
          {paidTable}
        </Panel>
      ) : (
        <EmptyPanel title={paidTitle} description={paidText} text={empty.paid} />
      )}
    </>
  );
}
