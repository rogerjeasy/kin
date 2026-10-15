import type { Metadata } from "next";

import { ChecksPanel } from "@/components/dashboard/bills/checks-panel";
import { PayeeCell } from "@/components/dashboard/bills/payee-cell";
import { DataTable } from "@/components/dashboard/ui/data-table";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { categoryName, isPayee, nameOf, payeeName } from "@/components/dashboard/words/names";
import { planLabel } from "@/components/dashboard/words/plan-words";
import { falseDemand } from "@/content/demo-circle/claim-check";
import { DEMO_PERIOD, NEXT_PERIOD } from "@/content/demo-circle/clock";
import { circleFormatters } from "@/content/demo-circle/format";
import { paidBills } from "@/content/demo-circle/record";
import { upcomingBills } from "@/content/demo-circle/upcoming";
import { dashboardMetadata } from "@/i18n/page-context";
import { dashboardContext } from "@/server/dashboard-context";
import { fill } from "@/i18n/template";

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard/bills">): Promise<Metadata> {
  return dashboardMetadata(params, "bills");
}

export default async function BillsPage({ params }: PageProps<"/[locale]/dashboard/bills">) {
  const { locale, dictionary } = await dashboardContext(params, "bills");
  const { bills, common } = dictionary.dashboard;
  const format = circleFormatters(locale);
  const upcomingTitle = fill(bills.upcoming.title, { month: format.month(NEXT_PERIOD) });
  const paidTitle = fill(bills.paid.title, { month: format.month(DEMO_PERIOD) });
  const { columns: up } = bills.upcoming;
  const { columns: paid } = bills.paid;

  return (
    <>
      <PageHeader title={bills.title} lede={bills.lede} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title={upcomingTitle} description={bills.upcoming.text} flush>
          <DataTable
            caption={upcomingTitle}
            primary="payee"
            columns={[
              { key: "payee", header: up.payee },
              { key: "due", header: up.due },
              { key: "approval", header: up.approval },
              { key: "amount", header: up.amount, align: "end" },
            ]}
            rows={upcomingBills().map((bill) => ({
              id: `${bill.payeeId}-${bill.due}`,
              cells: {
                payee: <PayeeCell name={payeeName(dictionary, bill.payeeId)} detail={categoryName(dictionary, bill.category)} />,
                due: format.day(bill.due),
                approval: common.planLabels[planLabel(bill.plan)],
                amount: format.money(bill.expectedCents),
              },
            }))}
          />
        </Panel>
        <ChecksPanel
          title={bills.checks.title}
          description={bills.checks.text}
          demand={{
            day: format.day(falseDemand.day),
            title: fill(bills.checks.falseDemand.title, { claimed: format.money(falseDemand.claimedCents) }),
            text: fill(bills.checks.falseDemand.text, {
              day: format.day(falseDemand.day),
              paid: format.money(falseDemand.lastPaid.cents),
              paidDay: format.day(falseDemand.lastPaid.day),
              alerted: format.allOf(falseDemand.alerted.map((id) => nameOf(dictionary, id))),
            }),
            verdict: bills.checks.verdict,
          }}
          passed={[bills.checks.noDuplicates, bills.checks.noJumps]}
        />
      </div>
      <Panel title={paidTitle} description={bills.paid.text} flush>
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
          rows={paidBills().map((bill) => ({
            id: bill.id,
            cells: {
              payee: (
                <PayeeCell
                  name={isPayee(bill.payeeId) ? payeeName(dictionary, bill.payeeId) : bill.payeeId}
                  detail={bill.category ? categoryName(dictionary, bill.category) : undefined}
                  tags={[common.confirmed, common.simulated]}
                />
              ),
              approved: bill.approvedOn ? format.day(bill.approvedOn) : "",
              paid: format.day(bill.paidOn),
              fee: format.money(bill.feeCents),
              amount: format.money(bill.cents),
            },
          }))}
        />
      </Panel>
    </>
  );
}
