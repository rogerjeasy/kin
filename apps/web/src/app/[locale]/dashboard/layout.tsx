import { PAUSE_HOURS } from "@kin/domain";
import { Suspense } from "react";

import { CreateCircle } from "@/components/dashboard/create-circle/create-circle";
import { AppShell } from "@/components/dashboard/shell/app-shell";
import { NoticeBanner } from "@/components/dashboard/shell/notice-banner";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { waitingProposals } from "@/content/circle/proposal-view";
import { needsOf } from "@/content/circle/shift-views";
import { shellCircle } from "@/content/circle/shell";
import { circleSlots } from "@/content/circle/words";
import { circleNotices } from "@/content/dashboard-notices";
import { presenceRoute, wishesRoute } from "@/content/dashboard-routes";
import { openTrigger } from "@/content/circle/wishes";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { may, sectionsFor, shellData } from "@/server/dashboard-context";
import { demoPayeeOf } from "@/server/sandbox-payout";

/**
 * The circle's screens, read from the database as the viewer. A demo visitor
 * sees their own copy of Rose's circle on its demo clock; a person who signed
 * in sees their own circle, or is offered to start one.
 */
export default async function DashboardLayout({ children, params }: LayoutProps<"/[locale]/dashboard">) {
  const { locale, dictionary, viewer, circle } = await shellData(params, "overview");
  const { shell, pause, notices, common } = dictionary.dashboard;
  if (circle === null) {
    const person = viewer.kind === "person" ? viewer.session : null;
    return (
      <CreateCircle
        locale={locale}
        copy={dictionary.dashboard.createCircle}
        levels={dictionary.dashboard.circle.parent.levels}
        signOut={shell.account.signOut}
        signedIn={{ label: shell.account.signedInAs, name: person?.name ?? shell.visitor, email: person?.email ?? "" }}
        notice={
          <Suspense fallback={null}>
            <NoticeBanner notices={notices} dismiss={notices.dismiss} />
          </Suspense>
        }
      />
    );
  }
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const slots = circleSlots(circle, format);
  const waitingCount = waitingProposals(circle).length;
  const waiting = format.count(waitingCount);
  // What waits for this viewer's tap or word on the care calendar.
  const askedCount = needsOf(circle).length;
  const asked = format.count(askedCount);
  const hours = { hours: format.count(PAUSE_HOURS) };
  const { now, demo, pausedUntil, pausedBy } = circle.circle;
  const me = circle.members.find((member) => member.id === circle.viewer.memberId);
  const paused = pausedUntil !== null && pausedUntil.getTime() > now.getTime();
  const { heldByPresenceUntil } = circle.circle;
  const presenceHold =
    heldByPresenceUntil !== null && heldByPresenceUntil.getTime() > now.getTime()
      ? { text: fill(shell.presenceHold.text, { until: format.dateTime(heldByPresenceUntil) }), link: may(circle, "money.view") ? { href: localizedPath(locale, presenceRoute), label: shell.presenceHold.link } : null }
      : null;

  // Someone said the parent is in hospital or a care home: every screen says so while it is reported or in effect.
  const trigger = openTrigger(circle);
  const wishesCopy = dictionary.dashboard.wishes;
  const reporter = trigger?.attestations.find((each) => each.stance === "start")?.memberId ?? null;
  const wishesNotice =
    trigger === null
      ? null
      : {
          text: fill(trigger.state === "active" ? wishesCopy.banner.active : wishesCopy.banner.reported, { parent: slots.parent, name: names.member(reporter), where: wishesCopy.trigger.where[trigger.event] }),
          link: { href: localizedPath(locale, wishesRoute), label: wishesCopy.banner.link },
        };

  return (
    <AppShell
      wishesNotice={wishesNotice}
      notices={circleNotices(notices, demoPayeeOf(circle))}
      locale={locale}
      dictionary={dictionary}
      month={slots.month}
      clock={demo ? fill(shell.clock, { date: format.longDay(now) }) : format.longDay(now)}
      viewer={viewer.kind === "person" ? { kind: "person", name: viewer.session.name, email: viewer.session.email } : { kind: "visitor", name: shell.visitor, email: null }}
      circle={shellCircle(circle)}
      demo={
        viewer.kind === "visitor" && me
          ? {
              seat: fill(shell.demo.seat, { name: me.displayName, role: common.roles[me.role] }),
              text: fill(shell.demo.text, { name: me.displayName, role: common.roles[me.role] }),
              personas: circle.members
                .filter((member) => member.status === "active")
                .map((member) => ({ memberId: member.id, name: member.displayName, role: common.roles[member.role], portrait: member.portrait, current: member.id === me.id })),
            }
          : null
      }
      sections={sectionsFor(circle)}
      pause={{ ...pause, title: fill(pause.title, hours), confirm: fill(pause.confirm, hours), points: pause.points.map((point) => fill(point, { parent: slots.parent })) }}
      pauseState={{
        active: paused ? fill(pause.active, { until: format.dateTime(pausedUntil), name: names.member(pausedBy) }) : null,
        canPause: may(circle, "circle.pause"),
        canResume: paused && (circle.viewer.role === "organizer" || pausedBy === circle.viewer.memberId),
      }}
      presenceHold={presenceHold}
      badges={{
        ...(askedCount > 0 ? { shifts: { value: asked, label: fill(shell.waiting, { count: asked }) } } : {}),
        ...(waitingCount > 0 ? { approvals: { value: waiting, label: fill(shell.waiting, { count: waiting }) } } : {}),
      }}
    >
      {children}
    </AppShell>
  );
}
