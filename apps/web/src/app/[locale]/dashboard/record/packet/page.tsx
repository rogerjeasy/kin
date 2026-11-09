import { HOUSEHOLD_TAX_SOURCE, judgeRate } from "@kin/domain";
import { DownloadIcon, FileCheck2Icon, FileWarningIcon, ScaleIcon, ShieldAlertIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LookbackGrid } from "@/components/dashboard/packet/lookback-grid";
import { lookbackScreenRows } from "@/components/dashboard/packet/lookback-rows";
import { ProvenanceBadge } from "@/components/dashboard/ai/provenance-badge";
import { DataTable } from "@/components/dashboard/ui/data-table";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatTile } from "@/components/dashboard/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { careAgreementsRoute, packetRoute } from "@/content/dashboard-routes";
import { directionOf } from "@/i18n/locales";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { dashboardContext } from "@/server/dashboard-context";
import { englishMoney } from "@/server/packet/english";
import { packetData } from "@/server/packet/data";
import { packetNote } from "@/server/packet/note";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/record/packet">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.dashboard.meta.packet;
  return { title, description, robots: { index: false, follow: false } };
}

export default async function PacketPage({ params, searchParams }: PageProps<"/[locale]/dashboard/record/packet">) {
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "record");
  const copy = dictionary.dashboard.packet;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const { note: asked } = await searchParams;
  const { view, report } = await packetData({ userId: viewer.userId, circle, locale, dictionary, keepAs: "verify" });
  const { summary } = view;
  const counted = summary.rows.filter((row) => row.status !== "reversed");
  const lackingCount = counted.filter((row) => row.status === "needs_documentation").length;
  const note = await packetNote(view, { currency: circle.circle.currency, chainOk: report.ok }, { asked: asked === "1", userId: viewer.userId, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes });
  const base = localizedPath(locale, packetRoute);
  const rows = lookbackScreenRows(summary.rows, copy.lookback, names, format);
  const noteNotice = note.status === "unavailable" ? copy.note.unavailable : note.status === "busy" ? copy.note.busy : null;

  const estimateRows = view.estimates.map((estimate) => ({
    id: `${estimate.employee}-${estimate.year}`,
    cells: {
      employee: estimate.employee,
      year: String(estimate.year),
      wages: format.money(estimate.wagesCents),
      threshold: !estimate.known ? copy.estimate.unknownYear : estimate.aboveThreshold ? copy.estimate.above : copy.estimate.below,
      social: estimate.known ? format.money(estimate.socialSecurityCents) : "—",
      medicare: estimate.known ? format.money(estimate.medicareCents) : "—",
      futa: estimate.known ? format.money(estimate.futaCents) : "—",
      total: estimate.known ? format.money(estimate.totalCents) : "—",
    },
  }));
  const ratesOf = circle.careAgreements
    .filter((agreement) => agreement.status !== "withdrawn")
    .map((agreement) => ({ agreement, ...judgeRate(agreement.rateCentsPerHour, circle.circle.currency) }));
  const benchmark = ratesOf.find((each) => each.benchmark !== null)?.benchmark ?? null;

  return (
    <>
      <PageHeader
        title={copy.title}
        lede={copy.lede}
        actions={
          <Button asChild size="sm" className="min-h-11 w-full sm:w-auto">
            {/* A plain link: the browser downloads the ZIP, and the route checks the viewer again. */}
            <a href={`${base}/export${asked === "1" ? "?note=1" : ""}`} download>
              <DownloadIcon aria-hidden="true" />
              {copy.download}
            </a>
          </Button>
        }
      />
      <p className="rounded-xl border bg-secondary/40 p-3 text-sm text-pretty">{copy.notice}</p>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={copy.tiles.window.label} value={format.money(summary.outflowCents)} note={fill(copy.tiles.window.note, { from: format.dayWithYear(summary.from), to: format.dayWithYear(summary.to) })} icon={ScaleIcon} />
        <StatTile label={copy.tiles.documented.label} value={format.money(summary.documentedCents)} note={copy.tiles.documented.note} icon={FileCheck2Icon} />
        <StatTile label={copy.tiles.lacking.label} value={format.money(summary.lackingCents)} note={fill(copy.tiles.lacking.note, { count: format.count(lackingCount) })} icon={FileWarningIcon} />
        <StatTile
          label={report.ok ? copy.tiles.chain.pass : copy.tiles.chain.fail}
          value={format.count(report.entryCount)}
          note={fill(copy.tiles.chain.note, { count: format.count(report.entryCount) })}
          icon={report.ok ? ShieldCheckIcon : ShieldAlertIcon}
        />
      </dl>
      <Panel
        title={copy.note.title}
        description={copy.note.text}
        aside={
          <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:w-auto">
            <Link href={`${base}?note=1`} scroll={false}>
              <SparklesIcon aria-hidden="true" />
              {copy.note.ask}
            </Link>
          </Button>
        }
      >
        {noteNotice === null ? null : <p className="mb-3 text-sm text-muted-foreground">{noteNotice}</p>}
        <p lang="en" dir="ltr" className="text-pretty">
          {note.text}
        </p>
        <p className="mt-3">
          <ProvenanceBadge provenance={note.provenance} kind="worded" copy={dictionary.aiProvenance} />
        </p>
      </Panel>
      <Panel title={copy.lookback.title} description={copy.lookback.text} flush>
        {rows.length > 0 ? (
          <LookbackGrid rows={rows} copy={copy.lookback} grid={dictionary.dataGrid} rtl={directionOf(locale) === "rtl"} />
        ) : (
          <div className="px-5 pb-5 sm:px-6">
            <EmptyState text={copy.lookback.empty} />
          </div>
        )}
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={copy.rate.title} description={copy.rate.text} link={{ href: localizedPath(locale, careAgreementsRoute), label: dictionary.dashboard.careAgreements.title }}>
          {ratesOf.length === 0 ? (
            <EmptyState text={copy.rate.none} />
          ) : (
            <ul className="space-y-2 text-sm">
              {ratesOf.map(({ agreement, judgement }) => (
                <li key={agreement.id}>{fill(copy.rate[judgement], { rate: format.money(agreement.rateCentsPerHour) })}</li>
              ))}
            </ul>
          )}
          {benchmark === null ? null : (
            <p className="mt-3 text-xs text-muted-foreground">{fill(copy.rate.source, { source: benchmark.source, collected: benchmark.collected, median: englishMoney(benchmark.medianCentsPerHour, benchmark.currency) })}</p>
          )}
        </Panel>
        <Panel title={copy.inside.title}>
          <ul className="list-disc space-y-1.5 ps-5 text-sm">
            {copy.inside.items.map((item) => (
              <li key={item} className="text-pretty">
                {item}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title={copy.estimate.title} description={copy.estimate.text} flush>
        {estimateRows.length > 0 ? (
          <DataTable
            caption={copy.estimate.title}
            primary="employee"
            columns={[
              { key: "employee", header: copy.estimate.cols.employee },
              { key: "year", header: copy.estimate.cols.year },
              { key: "wages", header: copy.estimate.cols.wages, align: "end" },
              { key: "threshold", header: copy.estimate.cols.threshold },
              { key: "social", header: copy.estimate.cols.social, align: "end" },
              { key: "medicare", header: copy.estimate.cols.medicare, align: "end" },
              { key: "futa", header: copy.estimate.cols.futa, align: "end" },
              { key: "total", header: copy.estimate.cols.total, align: "end" },
            ]}
            rows={estimateRows}
          />
        ) : (
          <div className="px-5 pb-5 sm:px-6">
            <EmptyState text={copy.estimate.empty} />
          </div>
        )}
        <div className="space-y-2 px-5 py-4 text-xs text-muted-foreground sm:px-6">
          <p>{fill(copy.estimate.source, { source: HOUSEHOLD_TAX_SOURCE })}</p>
          <p>{copy.estimate.exemption}</p>
        </div>
      </Panel>
    </>
  );
}
