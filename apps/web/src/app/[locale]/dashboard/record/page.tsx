import { describeAccount } from "@kin/domain";
import { DownloadIcon } from "lucide-react";
import type { Metadata } from "next";

import { FILTER_OF } from "@/components/dashboard/record/record-filters";
import { RecordList } from "@/components/dashboard/record/record-list";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { describeAccountCode, describeEntry, entryTag } from "@/components/dashboard/words/entry-words";
import { Button } from "@/components/ui/button";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { openPeriod } from "@/content/circle/period";
import { recordEntries } from "@/content/circle/record";
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
  const { record, common, empty } = dictionary.dashboard;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const entries = recordEntries(circle);

  const items = entries.map((view) => {
    const { entry } = view;
    const note = entry.kind === "care_credit" ? record.careNote : view.feeCents > 0 ? fill(record.fee, { fee: format.money(view.feeCents) }) : null;
    return {
      id: entry.id,
      filter: FILTER_OF[entry.kind],
      isoDay: entry.occurredOn,
      cents: view.cents,
      day: format.day(entry.occurredOn),
      text: describeEntry(dictionary, names, view),
      kind: common.entryKinds[entry.kind],
      source: record.sources[entry.source.type],
      amount: format.money(view.cents),
      flow: view.poolFlow,
      note,
      tags: [entryTag(dictionary, entry)],
      lines: entry.lines.map((line) => {
        const account = describeAccount(line.account);
        const amount = format.money(line.cents);
        return {
          account: describeAccountCode(dictionary, names, account.family, account.subject),
          debit: line.direction === "debit" ? amount : "",
          credit: line.direction === "credit" ? amount : "",
        };
      }),
    };
  });

  return (
    <>
      <PageHeader eyebrow={format.month(openPeriod(circle))} title={record.title} lede={record.lede} />
      <Panel
        title={fill(record.summary, { count: format.count(entries.length) })}
        aside={
          items.length > 0 ? (
            // A plain link: the browser downloads the file, and the route checks the viewer again.
            <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:w-auto">
              <a href={`${localizedPath(locale, dashboardRoutes.record)}/export`} download>
                <DownloadIcon aria-hidden="true" />
                {record.download}
              </a>
            </Button>
          ) : null
        }
        flush
      >
        {items.length > 0 ? (
          <RecordList copy={record} items={items} rtl={directionOf(locale) === "rtl"} />
        ) : (
          <div className="px-5 pb-5 sm:px-6">
            <EmptyState text={empty.record} />
          </div>
        )}
      </Panel>
    </>
  );
}
