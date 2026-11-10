import type { Metadata } from "next";

import { AnnouncementList } from "@/components/dashboard/listen/announcement-list";
import { EveryChoice } from "@/components/dashboard/listen/every-choice";
import { ListenButton } from "@/components/dashboard/listen/listen-button";
import { ListenToday, type TodayLink } from "@/components/dashboard/listen/listen-today";
import { LiveRefresh } from "@/components/dashboard/shifts/live-refresh";
import { NeedsCards } from "@/components/dashboard/shifts/needs-cards";
import { wordNeedItems } from "@/components/dashboard/shifts/worded-needs";
import { needItems } from "@/content/circle/shift-needs";
import { anythingMoving, needsOf } from "@/content/circle/shift-views";
import { circleSlots } from "@/content/circle/words";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { announcementSentence } from "@/components/dashboard/words/announcement-words";
import { DEFAULT_ANNOUNCE_EVERY, announcements, isAnnounceEvery, type AnnounceEvery } from "@/content/circle/announcements";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { askRoute, dashboardRoutes, listenRoute, purseRoute } from "@/content/dashboard-routes";
import { waitingProposals } from "@/content/circle/proposal-view";
import { fill } from "@/i18n/template";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { dashboardContext, may } from "@/server/dashboard-context";
import { speechServices } from "@/server/speech";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/listen">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, lede } = dictionary.dashboard.listen;
  return { title, description: lede, robots: { index: false, follow: false } };
}

export default async function ListenPage({ params, searchParams }: PageProps<"/[locale]/dashboard/listen">) {
  // Whoever may see the circle's money may hear it (SECTION_ACCESS.listen).
  const { locale, dictionary, viewer, circle } = await dashboardContext(params, "listen");
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
  const path = (route: string) => localizedPath(locale, route);
  // What waits for this person's own yes, as the approval engine decided.
  const mine = waitingProposals(circle).filter((view) => view.slots.some((slot) => slot.waitingFor.includes(circle.viewer.memberId))).length;
  const today: TodayLink[] = [
    { key: "yes", icon: "yes", href: path(dashboardRoutes.approvals), label: copy.today.yes, note: mine > 0 ? fill(copy.today.yesCount, { count: format.count(mine) }) : copy.today.yesNone },
    ...(may(circle, "purse.view") && circle.viewer.role === "parent" ? [{ key: "purse", icon: "purse" as const, href: path(purseRoute), label: copy.today.purse }] : []),
    { key: "ask", icon: "ask", href: path(askRoute), label: copy.today.ask },
    { key: "overview", icon: "overview", href: path(dashboardRoutes.overview), label: copy.today.overview },
  ];

  return (
    <>
      <PageHeader title={copy.title} lede={copy.lede} />
      <ListenToday copy={copy.today} links={today} />
      {/* A visit that waits for her word is asked here too, so her first screen never hides it. */}
      <LiveRefresh active={anythingMoving(circle)} />
      <NeedsCards
        items={await wordNeedItems(needItems(circle, needsOf(circle), dictionary.dashboard.shifts, format, names), needsOf(circle), { circle, locale, dictionary, viewer, names, format })}
        copy={dictionary.dashboard.shifts}
        calls={dictionary.dashboard.shiftCalls}
        locale={locale}
        currency={circle.circle.currency}
        timezone={circle.circle.timezone}
        parent={circleSlots(circle, format).parent}
        approvalsHref={path(dashboardRoutes.approvals)}
      />
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
