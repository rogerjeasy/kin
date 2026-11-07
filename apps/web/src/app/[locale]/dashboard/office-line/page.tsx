import type { Metadata } from "next";

import { CallSimulator } from "@/components/dashboard/office-line/call-simulator";
import { RecentCalls } from "@/components/dashboard/office-line/recent-calls";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { circleFormatters } from "@/content/circle/format";
import { pageContext } from "@/i18n/page-context";
import { dashboardContext, may } from "@/server/dashboard-context";
import { databases } from "@/server/database";
import { recentOfficeCalls } from "@/server/office-line";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/office-line">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.dashboard.officeLine.meta;
  return { title, description, robots: { index: false, follow: false } };
}

export default async function OfficeLinePage({ params }: PageProps<"/[locale]/dashboard/office-line">) {
  // Whoever may see the circle's money may read its calls; only the roles that may check a demand may place one.
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "overview");
  const copy = dictionary.dashboard.officeLine;
  const calls = await recentOfficeCalls({ db: databases().app, userId: viewer.userId, circle });

  return (
    <>
      <PageHeader title={copy.title} lede={copy.lede} />
      {may(circle, "office_line.try") ? <CallSimulator locale={locale} copy={copy} /> : <p className="text-lg text-foreground">{copy.readOnly}</p>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title={copy.neverTitle}>
          <ul className="list-disc space-y-2 ps-5 text-sm">
            {copy.never.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Panel>
        <RecentCalls calls={calls} copy={copy} format={circleFormatters(locale, circle)} />
      </div>
    </>
  );
}
