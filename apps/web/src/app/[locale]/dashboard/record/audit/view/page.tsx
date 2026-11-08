import { DownloadIcon } from "lucide-react";
import type { Metadata } from "next";

import { RecordList } from "@/components/dashboard/record/record-list";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import { circleFormatters } from "@/content/circle/format";
import { ledgerRows } from "@/content/circle/ledger-rows";
import { circleNames } from "@/content/circle/names";
import { openPeriod } from "@/content/circle/period";
import { circleToday } from "@/content/circle/today";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { directionOf } from "@/i18n/locales";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { dashboardContext } from "@/server/dashboard-context";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/record/audit/view">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, lede } = dictionary.dataGrid.audit;
  return { title, description: lede, robots: { index: false, follow: false } };
}

/**
 * The audit trail on screen: every entry with its ID and the evidence behind
 * it, in the same grid as the Record, opened on the proof columns. The file
 * the audit export downloads is the same trail, one row to a ledger line.
 */
export default async function AuditTrailPage({ params }: PageProps<"/[locale]/dashboard/record/audit/view">) {
  const { locale, dictionary, circle } = await dashboardContext(params, "record");
  const { audit, states } = dictionary.dataGrid;
  const format = circleFormatters(locale, circle);
  const items = ledgerRows(circle, dictionary, circleNames(circle, dictionary), format);
  const generatedOn = circleToday(circle);
  const recordBase = localizedPath(locale, dashboardRoutes.record);

  return (
    <>
      <PageHeader
        eyebrow={format.month(openPeriod(circle))}
        title={audit.title}
        lede={audit.lede}
        actions={
          <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:w-auto print:hidden">
            <a href={`${recordBase}/audit`} download>
              <DownloadIcon aria-hidden="true" />
              {dictionary.dashboard.statement.audit.download}
            </a>
          </Button>
        }
      />
      <Panel title={fill(dictionary.dashboard.record.summary, { count: format.count(items.length) })} flush>
        {items.length > 0 ? (
          <RecordList
            variant="audit"
            copy={dictionary.dashboard.record}
            grid={dictionary.dataGrid}
            items={items}
            rtl={directionOf(locale) === "rtl"}
            locale={locale}
            currency={circle.circle.currency}
            circleName={circle.circle.name}
            generatedOn={generatedOn}
            storageKey={`kin.grid.audit.v1:${circle.circle.id}:${circle.viewer.memberId}`}
            fileName={`kin-audit-view-${generatedOn}.csv`}
          />
        ) : (
          <div className="px-5 pb-5 sm:px-6">
            <EmptyState title={states.emptyTitle} text={dictionary.dashboard.empty.record} />
          </div>
        )}
      </Panel>
    </>
  );
}
