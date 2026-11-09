import type { Metadata } from "next";

import { CheckForm } from "@/components/dashboard/presence/check-form";
import { FamilyCodePanel } from "@/components/dashboard/presence/family-code-panel";
import { RecentChecks } from "@/components/dashboard/presence/recent-checks";
import { VoicesPanel } from "@/components/dashboard/presence/voices-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { openPeriod } from "@/content/circle/period";
import { circleFormatters } from "@/content/circle/format";
import { pageContext } from "@/i18n/page-context";
import { localeNames } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { authConfig } from "@/server/auth/config";
import { dashboardContext, may } from "@/server/dashboard-context";
import { databases } from "@/server/database";
import { presenceScreen } from "@/server/presence";
import { isOfficeLocale } from "@kin/telephony";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/presence">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.dashboard.presence.meta;
  return { title, description, robots: { index: false, follow: false } };
}

export default async function PresencePage({ params }: PageProps<"/[locale]/dashboard/presence">) {
  // Whoever may see the circle's money may read its checks; only the roles that may check a demand may start one.
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "overview");
  const copy = dictionary.dashboard.presence;
  const format = circleFormatters(locale, circle);
  const { voices, checks, code } = await presenceScreen(
    { db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, origin: authConfig().webOrigin },
    isOfficeLocale(locale) ? locale : "en",
    openPeriod(circle),
  );

  return (
    <>
      <PageHeader title={copy.title} lede={copy.lede} />
      {may(circle, "presence.check") ? <CheckForm locale={locale} copy={copy} currency={circle.circle.currency} timezone={circle.circle.timezone} /> : <p className="text-lg text-foreground">{copy.readOnly}</p>}
      {code === null ? null : <FamilyCodePanel code={code} copy={copy.code} />}
      <div className="grid gap-6 xl:grid-cols-2">
        <VoicesPanel locale={locale} voices={voices} copy={copy} languageNames={localeNames} canManage={may(circle, "presence.manage")} />
        <RecentChecks checks={checks} copy={copy} format={format} locale={locale} approvalsHref={localizedPath(locale, dashboardRoutes.approvals)} />
      </div>
      <Panel title={copy.never.title}>
        <ul className="list-disc space-y-2 ps-5 text-sm">
          {copy.never.items.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
