import { DownloadIcon, FileTextIcon, ListChecksIcon, ScaleIcon, ShieldCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RecordList } from "@/components/dashboard/record/record-list";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import { dashboardRoutes, packetRoute, verifyRoute } from "@/content/dashboard-routes";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { openPeriod } from "@/content/circle/period";
import { ledgerRows } from "@/content/circle/ledger-rows";
import { circleToday } from "@/content/circle/today";
import { directionOf } from "@/i18n/locales";
import { dashboardMetadata } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { dashboardContext } from "@/server/dashboard-context";

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard/record">): Promise<Metadata> {
  return dashboardMetadata(params, "record");
}

export default async function RecordPage({ params }: PageProps<"/[locale]/dashboard/record">) {
  const { locale, dictionary, circle } = await dashboardContext(params, "record");
  const { record, empty } = dictionary.dashboard;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const items = ledgerRows(circle, dictionary, names, format);
  const verifyRoutePath = localizedPath(locale, verifyRoute);
  const recordBase = localizedPath(locale, dashboardRoutes.record);
  const generatedOn = circleToday(circle);

  return (
    <>
      <PageHeader eyebrow={format.month(openPeriod(circle))} title={record.title} lede={record.lede} />
      <Panel
        title={fill(record.summary, { count: format.count(items.length) })}
        aside={
          items.length > 0 ? (
            // A plain link: the browser downloads the file, and the route checks the viewer again.
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:w-auto">
                <Link href={`${recordBase}/statement`}>
                  <FileTextIcon aria-hidden="true" />
                  {dictionary.dashboard.statement.link}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:w-auto">
                <Link href={verifyRoutePath}>
                  <ShieldCheckIcon aria-hidden="true" />
                  {dictionary.dashboard.verify.link}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:w-auto">
                <Link href={localizedPath(locale, packetRoute)}>
                  <ScaleIcon aria-hidden="true" />
                  {dictionary.dashboard.packet.link}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:w-auto">
                <Link href={`${recordBase}/audit/view`}>
                  <ListChecksIcon aria-hidden="true" />
                  {dictionary.dataGrid.audit.link}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:w-auto">
                <a href={`${recordBase}/export`} download>
                  <DownloadIcon aria-hidden="true" />
                  {record.download}
                </a>
              </Button>
            </div>
          ) : null
        }
        flush
      >
        {items.length > 0 ? (
          <RecordList
            variant="record"
            copy={record}
            grid={dictionary.dataGrid}
            items={items}
            rtl={directionOf(locale) === "rtl"}
            locale={locale}
            currency={circle.circle.currency}
            circleName={circle.circle.name}
            generatedOn={generatedOn}
            storageKey={`kin.grid.record.v1:${circle.circle.id}:${circle.viewer.memberId}`}
            fileName={`kin-record-view-${generatedOn}.csv`}
          />
        ) : (
          <div className="px-5 pb-5 sm:px-6">
            <EmptyState title={dictionary.dataGrid.states.emptyTitle} text={empty.record} />
          </div>
        )}
      </Panel>
    </>
  );
}
