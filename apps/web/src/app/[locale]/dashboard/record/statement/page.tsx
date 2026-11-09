import { monthlyStatement, yearInReview } from "@kin/domain";
import { asPerson, readPresenceSummary } from "@kin/db";
import { DownloadIcon, HandHeartIcon, ReceiptIcon, ShieldCheckIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import type { Metadata } from "next";

import { RecordList } from "@/components/dashboard/record/record-list";
import { AmountList } from "@/components/dashboard/statement/amount-list";
import { MonthLinks } from "@/components/dashboard/statement/month-links";
import { PrintButton } from "@/components/dashboard/statement/print-button";
import { YearGrid } from "@/components/dashboard/statement/year-grid";
import { DataTable } from "@/components/dashboard/ui/data-table";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatTile } from "@/components/dashboard/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { circleFormatters } from "@/content/circle/format";
import { ledgerRows } from "@/content/circle/ledger-rows";
import { circleNames } from "@/content/circle/names";
import { periodSettlement } from "@/content/circle/fairness";
import { expectedAfter, requestedPeriod, statementPeriods } from "@/content/circle/statement";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { circleToday } from "@/content/circle/today";
import { directionOf } from "@/i18n/locales";
import { dashboardContext } from "@/server/dashboard-context";
import { databases } from "@/server/database";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/record/statement">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, lede } = dictionary.dashboard.statement;
  return { title, description: lede, robots: { index: false, follow: false } };
}

export default async function StatementPage({ params, searchParams }: PageProps<"/[locale]/dashboard/record/statement">) {
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "record");
  const copy = dictionary.dashboard.statement;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const { month } = await searchParams;
  const period = requestedPeriod(circle, typeof month === "string" ? month : undefined);
  const year = period.slice(0, 4);
  const statement = monthlyStatement({ ledger: circle.ledger, period });
  const review = yearInReview({ ledger: circle.ledger, year });
  const settlement = periodSettlement(circle, period);
  const expected = expectedAfter(circle, period);
  const base = `${localizedPath(locale, dashboardRoutes.record)}/statement`;
  const recordBase = localizedPath(locale, dashboardRoutes.record);
  const settled = statement.settlementCollectedCents > 0 || statement.settlementPaidCents > 0;
  const activeMonths = review.months.filter((each) => each.entryCount > 0);
  const grid = dictionary.dataGrid;
  const generatedOn = circleToday(circle);
  const periodEntries = ledgerRows(circle, dictionary, names, format).filter((row) => row.period === period);
  // What "is it really you?" stopped this month: the amounts asked for in checks where the real person said it was not them. Not money in the ledger, so it is read apart from it.
  const stopped = await asPerson(databases().app, viewer.userId, (tx) => readPresenceSummary(tx, circle.circle.id, period));

  return (
    <>
      <PageHeader
        eyebrow={fill(copy.forMonth, { month: format.month(period) })}
        title={copy.title}
        lede={copy.lede}
        actions={
          <>
            <PrintButton label={copy.print} />
            <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:w-auto print:hidden">
              <a href={`${recordBase}/audit`} download>
                <DownloadIcon aria-hidden="true" />
                {copy.audit.download}
              </a>
            </Button>
          </>
        }
      />
      <MonthLinks
        label={copy.month}
        current={period}
        months={statementPeriods(circle).map((each) => ({ period: each, label: format.month(each), href: `${base}?month=${each}` }))}
      />
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={copy.glance.title}>
        <StatTile label={copy.glance.paidIn} value={format.money(statement.contributedCents)} note={format.month(period)} icon={TrendingUpIcon} />
        <StatTile label={copy.glance.spent} value={format.money(statement.spentCents)} note={format.month(period)} icon={TrendingDownIcon} />
        <StatTile label={copy.glance.caregiver} value={format.money(statement.caregiverPayCents)} note={format.month(period)} icon={HandHeartIcon} />
        <StatTile label={copy.glance.fees} value={format.money(statement.feesCents)} note={format.month(period)} icon={ReceiptIcon} />
      </dl>
      {stopped.checks > 0 ? (
        <dl className="grid grid-cols-1 gap-4" aria-label={dictionary.dashboard.presence.statement.label}>
          <StatTile
            label={dictionary.dashboard.presence.statement.label}
            value={format.money(stopped.stoppedCents)}
            note={fill(dictionary.dashboard.presence.statement.note, { denied: String(stopped.denied), checks: String(stopped.checks) })}
            icon={ShieldCheckIcon}
          />
        </dl>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={copy.contributions.title}>
          <AmountList
            items={statement.contributions.map((each) => ({ id: each.subject, label: names.member(each.subject), amount: format.money(each.cents) }))}
            empty={copy.contributions.empty}
            total={{ label: copy.glance.paidIn, amount: format.money(statement.contributedCents) }}
          />
        </Panel>
        <Panel title={copy.spending.title}>
          <AmountList
            items={statement.spending.map((each) => ({ id: each.subject, label: names.category(each.subject), amount: format.money(each.cents) }))}
            empty={copy.spending.empty}
            total={{ label: copy.glance.spent, amount: format.money(statement.spentCents) }}
          />
        </Panel>
        <Panel title={copy.caregiver.title}>
          <AmountList
            items={statement.caregiverPay.map((each) => ({ id: each.subject, label: names.payee(each.subject), amount: format.money(each.cents) }))}
            empty={copy.caregiver.empty}
            total={{ label: copy.glance.caregiver, amount: format.money(statement.caregiverPayCents) }}
          />
        </Panel>
        {settlement === null ? null : (
          <Panel title={copy.settlement.title} description={copy.settlement.text}>
            {settlement.plan.payouts.length + settlement.plan.collections.length === 0 ? (
              <EmptyState text={copy.settlement.none} />
            ) : (
              <AmountList
                items={[
                  ...settlement.plan.payouts.map((each) => ({
                    id: `out-${each.memberId}`,
                    label: fill(copy.settlement.payout, { name: names.member(each.memberId), amount: format.money(each.cents) }),
                  })),
                  ...settlement.plan.collections.map((each) => ({
                    id: `in-${each.memberId}`,
                    label: fill(copy.settlement.collection, { name: names.member(each.memberId), amount: format.money(each.cents) }),
                  })),
                ]}
                empty={copy.settlement.none}
              />
            )}
            {settled ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {fill(copy.settlement.settled, { collected: format.money(statement.settlementCollectedCents), paid: format.money(statement.settlementPaidCents) })}
              </p>
            ) : null}
          </Panel>
        )}
        <Panel title={copy.next.title} description={copy.next.text} className="lg:col-span-2">
          <AmountList
            items={expected.map((bill) => ({
              id: bill.id,
              label: fill(copy.next.item, { payee: names.payee(bill.payeeId), amount: format.money(bill.expectedCents), day: format.day(bill.due) }),
            }))}
            empty={copy.next.empty}
          />
        </Panel>
      </div>
      <Panel title={fill(copy.year.title, { year })} description={copy.year.text} flush>
        {activeMonths.length === 0 ? (
          <div className="px-5 pb-5 sm:px-6">
            <EmptyState text={copy.year.empty} />
          </div>
        ) : (
          <>
            <div className="hidden px-5 pb-5 md:block sm:px-6">
              <YearGrid
                label={fill(grid.statement.yearGridLabel, { year })}
                copy={grid}
                rtl={directionOf(locale) === "rtl"}
                locale={locale}
                currency={circle.circle.currency}
                headers={{ month: copy.year.month, paidIn: copy.year.paidIn, spent: copy.year.spent, caregiver: copy.year.caregiver }}
                rows={activeMonths.map((each) => ({ id: each.period, month: format.month(each.period), paidInCents: each.contributedCents, spentCents: each.spentCents, caregiverCents: each.caregiverPayCents }))}
                total={{ id: year, month: year, paidInCents: review.contributedCents, spentCents: review.spentCents, caregiverCents: review.caregiverPayCents }}
              />
            </div>
            <div className="md:hidden">
              <DataTable
                caption={fill(copy.year.title, { year })}
                primary="month"
                columns={[
                  { key: "month", header: copy.year.month },
                  { key: "paidIn", header: copy.year.paidIn, align: "end" },
                  { key: "spent", header: copy.year.spent, align: "end" },
                  { key: "caregiver", header: copy.year.caregiver, align: "end" },
                ]}
                rows={[
                  ...activeMonths.map((each) => ({
                    id: each.period,
                    cells: {
                      month: format.month(each.period),
                      paidIn: format.money(each.contributedCents),
                      spent: format.money(each.spentCents),
                      caregiver: format.money(each.caregiverPayCents),
                    },
                  })),
                  {
                    id: "total",
                    cells: {
                      month: <strong>{year}</strong>,
                      paidIn: <strong>{format.money(review.contributedCents)}</strong>,
                      spent: <strong>{format.money(review.spentCents)}</strong>,
                      caregiver: <strong>{format.money(review.caregiverPayCents)}</strong>,
                    },
                  },
                ]}
              />
            </div>
          </>
        )}
      </Panel>
      <Panel title={fill(grid.statement.entriesTitle, { month: format.month(period) })} description={grid.statement.entriesText} flush>
        {periodEntries.length === 0 ? (
          <div className="px-5 pb-5 sm:px-6">
            <EmptyState text={grid.statement.entriesEmpty} />
          </div>
        ) : (
          <RecordList
            variant="audit"
            copy={dictionary.dashboard.record}
            grid={grid}
            items={periodEntries}
            rtl={directionOf(locale) === "rtl"}
            locale={locale}
            currency={circle.circle.currency}
            circleName={circle.circle.name}
            generatedOn={generatedOn}
            storageKey={`kin.grid.statement.v1:${circle.circle.id}:${circle.viewer.memberId}`}
            fileName={`kin-statement-${period}.csv`}
          />
        )}
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={`${copy.year.categories} · ${year}`}>
          <AmountList
            items={review.spending.map((each) => ({ id: each.subject, label: names.category(each.subject), amount: format.money(each.cents) }))}
            empty={copy.year.empty}
          />
        </Panel>
        <Panel title={`${copy.year.ownPocket} · ${year}`}>
          <AmountList
            items={review.ownPocket.map((each) => ({ id: each.subject, label: names.member(each.subject), amount: format.money(each.cents) }))}
            empty={copy.year.empty}
          />
        </Panel>
      </div>
    </>
  );
}
