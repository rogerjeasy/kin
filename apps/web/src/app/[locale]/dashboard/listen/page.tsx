import type { Metadata } from "next";

import { AnnouncementList } from "@/components/dashboard/listen/announcement-list";
import { EveryChoice } from "@/components/dashboard/listen/every-choice";
import { ListenButton } from "@/components/dashboard/listen/listen-button";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { announcementSentence } from "@/components/dashboard/words/announcement-words";
import { DEFAULT_ANNOUNCE_EVERY, announcements, isAnnounceEvery, type AnnounceEvery } from "@/content/circle/announcements";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { listenRoute } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { dashboardContext } from "@/server/dashboard-context";
import { speechServices } from "@/server/speech";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/listen">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, lede } = dictionary.dashboard.listen;
  return { title, description: lede, robots: { index: false, follow: false } };
}

export default async function ListenPage({ params, searchParams }: PageProps<"/[locale]/dashboard/listen">) {
  // Whoever may see the circle's money may hear it; the overview's access rule is that.
  const { locale, dictionary, circle } = await dashboardContext(params, "overview");
  const copy = dictionary.dashboard.listen;
  const { every: asked } = await searchParams;
  const every: AnnounceEvery = isAnnounceEvery(asked) ? asked : DEFAULT_ANNOUNCE_EVERY;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const items = announcements(circle, every).map((view) => ({
    id: view.entry.id,
    day: format.day(view.entry.occurredOn),
    text: announcementSentence(copy, names, format, view),
  }));
  const canSpeak = speechServices() !== null;

  return (
    <>
      <PageHeader title={copy.title} lede={copy.lede} />
      <EveryChoice current={every} href={(choice) => `${localizedPath(locale, listenRoute)}?every=${choice}`} copy={copy} />
      <Panel title={copy.heading} description={copy.kinNever}>
        {items.length === 0 ? (
          <EmptyState text={copy.empty} />
        ) : (
          <div className="space-y-6">
            <AnnouncementList items={items} />
            {canSpeak ? <ListenButton every={every} locale={locale} copy={copy} speech={dictionary.dashboard.speech} /> : <p className="text-lg text-foreground">{copy.unavailable}</p>}
          </div>
        )}
      </Panel>
    </>
  );
}
