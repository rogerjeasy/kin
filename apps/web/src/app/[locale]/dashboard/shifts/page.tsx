import { PAYOUT_WALLETS } from "@kin/db";
import { calendarDay } from "@kin/domain";
import type { Metadata } from "next";
import Link from "next/link";

import { LiveRefresh } from "@/components/dashboard/shifts/live-refresh";
import { CoverSection } from "@/components/dashboard/shifts/cover-section";
import { NeedsCards } from "@/components/dashboard/shifts/needs-cards";
import { PaymentReceived } from "@/components/dashboard/shifts/payment-received";
import { PayoutTargetForm } from "@/components/dashboard/shifts/payout-target-form";
import { ScheduleForm } from "@/components/dashboard/shifts/schedule-form";
import { ShiftCalendar } from "@/components/dashboard/shifts/shift-calendar";
import { ShiftCard } from "@/components/dashboard/shifts/shift-card";
import type { ShiftExtrasScope } from "@/components/dashboard/shifts/shift-extras";
import { ShiftWeekNav } from "@/components/dashboard/shifts/shift-week-nav";
import { wordNeedItems } from "@/components/dashboard/shifts/worded-needs";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { calendarData } from "@/content/circle/shift-calendar";
import { needItems, schedulePeople } from "@/content/circle/shift-needs";
import { shiftWeek } from "@/content/circle/shift-week";
import { anythingMoving, latestPaid, needsOf, shiftViews } from "@/content/circle/shift-views";
import { dashboardRoutes, shiftDoorRoute, shiftPermissionsRoute } from "@/content/dashboard-routes";
import { directionOf } from "@/i18n/locales";
import { dashboardMetadata } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { dashboardContext, may } from "@/server/dashboard-context";
import { parentDecides } from "@/server/shift-access";
import { venmoNote } from "@/server/shift-venmo";
import { textSender } from "@/server/text-sender";

export function generateMetadata({ params }: PageProps<"/[locale]/dashboard/shifts">): Promise<Metadata> {
  return dashboardMetadata(params, "shifts");
}

export default async function ShiftsPage({ params, searchParams }: PageProps<"/[locale]/dashboard/shifts">) {
  const { locale, dictionary, viewer, circle } = await dashboardContext(params, "shifts");
  const { week: asked } = await searchParams;
  const copy = dictionary.dashboard.shifts;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const week = shiftWeek(circle, typeof asked === "string" ? asked : undefined);
  const views = shiftViews(circle, week);
  const range = format.dayRange(week.start, week.end);
  const path = localizedPath(locale, dashboardRoutes.shifts);
  const approvalsHref = localizedPath(locale, dashboardRoutes.approvals);
  const paid = latestPaid(circle);
  const own = circle.payees.find((payee) => payee.payee.member?.memberId === circle.viewer.memberId && payee.caregiverRateCentsPerHour !== null);
  const wallet = circle.shiftRules.find((rules) => rules.payeeId === own?.id)?.payoutWallet;
  const extras: ShiftExtrasScope = {
    locale,
    timezone: circle.circle.timezone,
    viewerMemberId: circle.viewer.memberId,
    textingOn: textSender() !== null,
    fairnessHref: may(circle, "money.view") ? localizedPath(locale, dashboardRoutes.fairness) : null,
    links: dictionary.dashboard.shiftLinks,
    calls: dictionary.dashboard.shiftCalls,
  };
  const venmo = venmoNote(circle);

  return (
    <>
      <PageHeader
        title={copy.title}
        lede={fill(copy.lede, { parent: names.parent })}
        actions={
          <>
            {may(circle, "money.view") ? (
              <Link href={localizedPath(locale, shiftPermissionsRoute)} className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">
                {copy.permissionLink}
              </Link>
            ) : null}
            {may(circle, "shift.door") ? (
              <Link href={localizedPath(locale, shiftDoorRoute)} className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">
                {dictionary.dashboard.shiftDoor.link}
              </Link>
            ) : null}
          </>
        }
      />
      {circle.circle.demo ? <p className="max-w-3xl text-sm text-muted-foreground">{copy.simulated}</p> : null}
      <LiveRefresh active={anythingMoving(circle)} />
      {paid ? <PaymentReceived view={paid} copy={copy} format={format} /> : null}
      <NeedsCards items={await wordNeedItems(needItems(circle, needsOf(circle), copy, format, names), needsOf(circle), { circle, locale, dictionary, viewer, names, format })} copy={copy} locale={locale} currency={circle.circle.currency} timezone={circle.circle.timezone} parent={names.parent} approvalsHref={approvalsHref} calls={dictionary.dashboard.shiftCalls} />
      <CoverSection scope={{ circle, locale, dictionary, viewer, names, format }} />
      <section aria-labelledby="week-title" className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="week-title" className="text-lg font-semibold">{fill(week.current ? copy.week.thisWeek : copy.week.otherWeek, { range })}</h2>
          <ShiftWeekNav week={week} copy={copy.week} path={path} />
        </div>
        <ShiftCalendar
          {...calendarData(views, copy, names)}
          weekStart={week.start}
          timezone={circle.circle.timezone}
          locale={locale}
          dir={directionOf(locale)}
          now={circle.circle.now.toISOString()}
          label={fill(copy.week.calendarLabel, { range })}
          assistant={dictionary.dashboard.shiftAssistant}
        />
        {views.length === 0 ? (
          <EmptyState text={copy.week.empty} />
        ) : (
          <ul aria-label={fill(copy.week.listLabel, { range })} className="grid min-w-0 gap-4 lg:grid-cols-2">
            {views.map((view) => (
              <ShiftCard key={view.shift.id} view={view} copy={copy} format={format} names={names} parentDecides={parentDecides(circle)} approvalsHref={approvalsHref} extras={extras} />
            ))}
          </ul>
        )}
      </section>
      {may(circle, "shift.schedule") ? (
        <ScheduleForm copy={copy} timezone={circle.circle.timezone} people={schedulePeople(circle)} today={calendarDay(circle.circle.now, circle.circle.timezone).occurredOn} />
      ) : null}
      {own && wallet && may(circle, "payout_target.set") ? <PayoutTargetForm copy={copy} wallets={PAYOUT_WALLETS} current={{ wallet, address: own.receiver }} venmoNote={venmo === null ? null : copy.target[venmo === "refused" ? "venmoRefused" : "venmoSimulated"]} /> : null}
    </>
  );
}
