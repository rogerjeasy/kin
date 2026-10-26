import { ShieldCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import { CaregiverBills } from "@/components/dashboard/caregiver-billing/caregiver-bills";

import { ChecksPanel } from "@/components/dashboard/bills/checks-panel";
import { PayeeCell } from "@/components/dashboard/bills/payee-cell";
import { DataTable } from "@/components/dashboard/ui/data-table";
import { EmptyPanel } from "@/components/dashboard/ui/empty-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { planLabel } from "@/components/dashboard/words/plan-words";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { nextPeriod, openPeriod } from "@/content/circle/period";
import { paidBills } from "@/content/circle/record";
import { latestClaimCheck } from "@/content/circle/safety";
import { upcomingBills } from "@/content/circle/upcoming";
import { circleSlots } from "@/content/circle/words";
import { dashboardMetadata } from "@/i18n/page-context";
import { fill } from "@/i18n/template";
import { dashboardContext, may } from "@/server/dashboard-context";
import { structuredModel } from "@/server/model";

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
  const upcomingTitle = fill(bills.upcoming.title, { month: format.month(nextPeriod(period)) });
  const paidTitle = fill(bills.paid.title, { month: format.month(period) });
  const { columns: up } = bills.upcoming;
  const { columns: paid } = bills.paid;
  const check = may(circle, "safety.view") ? latestClaimCheck(circle) : null;
  const payeeOf = (payeeId: string | null) => (payeeId === null ? "" : names.payee(payeeId));

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
      rows={paidThisMonth.map((bill) => ({
        id: bill.id,
        cells: {
          payee: (
            <PayeeCell
              name={names.payee(bill.payeeId)}
              detail={bill.category ? names.category(bill.category) : undefined}
              // A simulated payment has no PayPal record behind it, so it never claims PayPal's confirmation.
              tags={bill.simulated ? [common.simulated] : [common.confirmed]}
            />
          ),
          approved: bill.approvedOn ? format.day(bill.approvedOn) : "",
          paid: format.day(bill.paidOn),
          fee: format.money(bill.feeCents),
          amount: format.money(bill.cents),
        },
      }))}
    />
  );

  return (
    <>
      <PageHeader title={bills.title} lede={bills.lede} />
      <CaregiverBills circle={circle} viewer={viewer} locale={locale} canDescribe={structuredModel() !== null} copy={dictionary.dashboard.caregiverBilling} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {upcoming.length > 0 ? (
          <Panel title={upcomingTitle} description={bills.upcoming.text} flush>
            {upcomingTable}
          </Panel>
        ) : (
          <EmptyPanel title={upcomingTitle} description={bills.upcoming.text} text={empty.comingUp} />
        )}
        {check && check.claimedCents !== null && check.lastPaid ? (
          <ChecksPanel
            title={bills.checks.title}
            description={bills.checks.text}
            demand={{
              day: format.day(check.checkedOn),
              title: fill(bills.checks.falseDemand.title, { claimed: format.money(check.claimedCents), payee: payeeOf(check.payeeId) }),
              text: fill(bills.checks.falseDemand.text, {
                parent: slots.parent,
                payee: payeeOf(check.payeeId),
                day: format.day(check.checkedOn),
                paid: format.money(check.lastPaid.cents),
                paidDay: format.day(check.lastPaid.day),
                alerted: format.allOf(check.alerted.map(names.member)),
              }),
              verdict: bills.checks.verdict,
            }}
            passed={[bills.checks.noDuplicates, bills.checks.noJumps]}
          />
        ) : may(circle, "safety.view") ? (
          <EmptyPanel title={empty.safety.title} text={empty.safety.text} icon={ShieldCheckIcon} />
        ) : null}
      </div>
      {paidThisMonth.length > 0 ? (
        <Panel title={paidTitle} description={bills.paid.text} flush>
          {paidTable}
        </Panel>
      ) : (
        <EmptyPanel title={paidTitle} description={bills.paid.text} text={empty.paid} />
      )}
    </>
  );
}
