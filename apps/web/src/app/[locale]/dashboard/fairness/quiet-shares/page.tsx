import type { Metadata } from "next";
import { UsersRoundIcon } from "lucide-react";

import { AskCard } from "@/components/dashboard/quiet-shares/ask-card";
import { PrivacyPanel } from "@/components/dashboard/quiet-shares/privacy-panel";
import { RaiseForm } from "@/components/dashboard/quiet-shares/raise-form";
import { screenFor } from "@/components/dashboard/quiet-shares/screen-for";
import { LiveRefresh } from "@/components/dashboard/shifts/live-refresh";
import { EmptyPanel } from "@/components/dashboard/ui/empty-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { ButtonLink } from "@/components/shared/button-link";
import { quietSharesFamilyRoute } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { dashboardContext, may } from "@/server/dashboard-context";
import { databases } from "@/server/database";
import { quietShareViews } from "@/server/quiet-shares";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/fairness/quiet-shares">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.dashboard.quietShares.meta;
  return { title, description, robots: { index: false, follow: false } };
}

export default async function QuietSharesPage({ params }: PageProps<"/[locale]/dashboard/fairness/quiet-shares">) {
  // Whoever sees the circle's money sees the asks; only those who share the cost answer, and only the organizer raises one.
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "fairness");
  const copy = dictionary.dashboard.quietShares;
  const asks = await quietShareViews({ db: databases().app, userId: viewer.userId, circle });
  const screen = screenFor(locale, dictionary, circle, null);
  // While someone may still answer, the screen asks again every few seconds, so "2 of 3" moves on its own.
  const moving = asks.some((ask) => ask.state === "gathering" || ask.state === "short" || ask.state === "planned");

  return (
    <>
      <PageHeader
        title={copy.title}
        lede={copy.lede}
        actions={
          circle.circle.demo && asks.length > 0 ? (
            <ButtonLink href={localizedPath(locale, quietSharesFamilyRoute)} size="sm">
              <UsersRoundIcon aria-hidden="true" />
              {copy.family.link}
            </ButtonLink>
          ) : null
        }
      />
      <LiveRefresh active={moving} />
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-3">
        <section aria-label={copy.asks.title} className="grid min-w-0 gap-6 lg:col-span-2">
          {asks.length === 0 ? <EmptyPanel title={copy.asks.title} text={copy.asks.empty} /> : asks.map((ask) => <AskCard key={ask.id} screen={screen} ask={ask} />)}
        </section>
        <div className="grid min-w-0 gap-6">
          <PrivacyPanel copy={copy.privacy} />
          {may(circle, "quiet_share.raise") ? <RaiseForm copy={copy} /> : null}
        </div>
      </div>
    </>
  );
}
