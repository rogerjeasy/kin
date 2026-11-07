import { ClipboardCheckIcon, DownloadIcon, HashIcon, ListChecksIcon, ShieldAlertIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { verifyBundle } from "@kin/verify";

import { CheckList, type CheckRow } from "@/components/dashboard/verify/check-list";
import { FindingsList } from "@/components/dashboard/verify/findings-list";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatTile } from "@/components/dashboard/ui/stat-tile";
import { describeEntry } from "@/components/dashboard/words/entry-words";
import { LANGUAGE_NAMES } from "@/components/dashboard/words/letter-words";
import { Button } from "@/components/ui/button";
import { circleBundle } from "@/content/circle/audit-bundle";
import { reviewItems } from "@/content/circle/audit-findings";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { entryView } from "@/content/circle/record";
import { dashboardRoutes, verifyRoute } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { auditorReview } from "@/server/auditor";
import { dashboardContext } from "@/server/dashboard-context";

/** The command that checks a downloaded export, shown beside the download. */
const COMMAND = "pnpm --filter @kin/verify run kin-verify kin-record.json";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/record/verify">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, lede } = dictionary.dashboard.verify;
  return { title, description: lede, robots: { index: false, follow: false } };
}

export default async function VerifyPage({ params, searchParams }: PageProps<"/[locale]/dashboard/record/verify">) {
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "record");
  const copy = dictionary.dashboard.verify;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const { auditor } = await searchParams;
  const asked = auditor === "1";
  const base = localizedPath(locale, verifyRoute);

  const bundle = circleBundle(circle, dictionary, names, format);
  const report = verifyBundle(bundle);
  const counts: Record<CheckRow["id"], string> = {
    chain: format.count(bundle.entries.length),
    head: format.count(bundle.entries.length),
    ledger: format.count(bundle.entries.length),
    settlement: format.count(bundle.settlements.length),
    wording: format.count(bundle.wording.length),
  };
  const rows = report.checks.map((check): CheckRow => ({ id: check.id, ok: check.ok, count: counts[check.id] }));
  const failed = rows.filter((row) => !row.ok).length;

  const review = await auditorReview(reviewItems(report, circle, dictionary, format), LANGUAGE_NAMES[locale], {
    asked,
    userId: viewer.userId,
    accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes,
  });
  const order = { critical: 0, attention: 1, info: 2 } as const;
  const findings = review.items
    .toSorted((a, b) => order[a.severity] - order[b.severity])
    .map((item) => {
      const entry = circle.ledger.entries.find((candidate) => candidate.id === item.entryId);
      return { id: item.id, severity: item.severity, text: item.text, source: item.source, about: entry === undefined ? null : describeEntry(dictionary, names, entryView(entry)) };
    });
  const notice = review.status === "unavailable" ? copy.auditor.unavailable : review.status === "busy" ? copy.auditor.busy : null;

  return (
    <>
      <PageHeader
        title={copy.title}
        lede={copy.lede}
        actions={
          <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:w-auto">
            <a href={`${base}/export`} download>
              <DownloadIcon aria-hidden="true" />
              {copy.download}
            </a>
          </Button>
        }
      />
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={report.ok ? copy.pass : copy.fail}>
        <StatTile
          label={report.ok ? copy.pass : copy.fail}
          value={format.count(report.entryCount)}
          note={report.ok ? fill(copy.passNote, { count: format.count(report.entryCount) }) : fill(copy.failNote, { failed: format.count(failed), total: format.count(rows.length) })}
          icon={report.ok ? ShieldCheckIcon : ShieldAlertIcon}
        />
        <StatTile label={copy.pool} value={format.money(report.poolCents)} note={copy.poolNote} icon={ListChecksIcon} />
        <StatTile label={copy.head} value={`${report.head.slice(0, 12)}…`} note={copy.headNote} icon={HashIcon} />
      </dl>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={copy.checksTitle}>
          <CheckList copy={copy.checks} rows={rows} />
        </Panel>
        <Panel title={copy.offlineTitle} description={copy.offlineText} aside={<ClipboardCheckIcon aria-hidden="true" className="size-5 text-muted-foreground" />}>
          <p dir="ltr" tabIndex={0} className="overflow-x-auto rounded-xl bg-muted p-3 font-mono text-sm whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {COMMAND}
          </p>
          <p dir="ltr" className="mt-3 text-sm break-all text-muted-foreground">
            {report.head}
          </p>
        </Panel>
      </div>
      <Panel
        title={copy.auditor.title}
        description={copy.auditor.text}
        aside={
          <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:w-auto">
            <Link href={`${base}?auditor=1`} scroll={false}>
              <SparklesIcon aria-hidden="true" />
              {copy.auditor.ask}
            </Link>
          </Button>
        }
      >
        {notice === null ? null : <p className="mb-4 text-sm text-muted-foreground">{notice}</p>}
        {findings.length === 0 ? <EmptyState text={copy.auditor.none} icon={ShieldCheckIcon} /> : <FindingsList copy={copy.auditor} rows={findings} />}
      </Panel>
      <p className="text-sm text-muted-foreground">
        <Link href={localizedPath(locale, dashboardRoutes.record)} className="font-semibold underline underline-offset-4">
          {dictionary.dashboard.shell.nav.record}
        </Link>
      </p>
    </>
  );
}
