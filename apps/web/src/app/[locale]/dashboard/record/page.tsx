import { describeAccount } from "@kin/domain";
import type { Metadata } from "next";

import { FILTER_OF } from "@/components/dashboard/record/record-filters";
import { RecordList } from "@/components/dashboard/record/record-list";
import { DemoActions } from "@/components/dashboard/ui/demo-actions";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { describeAccountCode, describeEntry } from "@/components/dashboard/words/entry-words";
import { DEMO_PERIOD } from "@/content/demo-circle/clock";
import { circleFormatters } from "@/content/demo-circle/format";
import { monthTotals, recordEntries } from "@/content/demo-circle/record";
import { directionOf } from "@/i18n/locales";
import { dashboardMetadata } from "@/i18n/page-context";
import { dashboardContext } from "@/server/dashboard-context";
import { fill } from "@/i18n/template";

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard/record">): Promise<Metadata> {
  return dashboardMetadata(params, "record");
}

export default async function RecordPage({ params }: PageProps<"/[locale]/dashboard/record">) {
  const { locale, dictionary } = await dashboardContext(params, "record");
  const { record, common, demoAction } = dictionary.dashboard;
  const format = circleFormatters(locale);
  const { entryCount } = monthTotals();

  const items = recordEntries().map((view) => {
    const { entry } = view;
    const note = entry.kind === "care_credit" ? record.careNote : view.feeCents > 0 ? fill(record.fee, { fee: format.money(view.feeCents) }) : null;
    return {
      id: entry.id,
      filter: FILTER_OF[entry.kind],
      isoDay: entry.occurredOn,
      cents: view.cents,
      day: format.day(entry.occurredOn),
      text: describeEntry(dictionary, view),
      kind: common.entryKinds[entry.kind],
      source: record.sources[entry.source.type],
      amount: format.money(view.cents),
      flow: view.poolFlow,
      note,
      tags: entry.simulated ? [common.simulated] : [],
      lines: entry.lines.map((line) => {
        const account = describeAccount(line.account);
        const amount = format.money(line.cents);
        return {
          account: describeAccountCode(dictionary, account.family, account.subject),
          debit: line.direction === "debit" ? amount : "",
          credit: line.direction === "credit" ? amount : "",
        };
      }),
    };
  });

  return (
    <>
      <PageHeader eyebrow={format.month(DEMO_PERIOD)} title={record.title} lede={record.lede} />
      <Panel
        title={fill(record.summary, { count: format.count(entryCount) })}
        aside={<DemoActions actions={[{ label: record.export, variant: "outline" }]} note={demoAction} className="w-full sm:w-auto" />}
        flush
      >
        <RecordList copy={record} items={items} rtl={directionOf(locale) === "rtl"} />
      </Panel>
    </>
  );
}
