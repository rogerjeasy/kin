import { calendarDay } from "@kin/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CallSettingsSection } from "@/components/dashboard/shift-calls/call-settings-section";
import { PayRulesForm } from "@/components/dashboard/shifts/pay-rules-form";
import { PermissionCard } from "@/components/dashboard/shifts/permission-card";
import { PermissionForm } from "@/components/dashboard/shifts/permission-form";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { circleFormatters } from "@/content/circle/format";
import { addDays } from "@/content/circle/mandate-words";
import { circleNames } from "@/content/circle/names";
import { mayGrantShiftPermission, permissionViews } from "@/content/circle/shift-permissions";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { dashboardContext, may } from "@/server/dashboard-context";

// A permission lasts a year at most: the suggested end leaves a day to spare.
const SUGGESTED_DAYS = 364;

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle/shifts">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  return { title: `${dictionary.dashboard.shiftPermissions.title} · Kin`, robots: { index: false, follow: false } };
}

export default async function ShiftPermissionsPage({ params }: PageProps<"/[locale]/dashboard/circle/shifts">) {
  const { locale, dictionary, circle } = await dashboardContext(params, "circle");
  // A caregiver never sees the family's money or permissions: their shifts are theirs instead.
  if (!may(circle, "money.view")) redirect(localizedPath(locale, dashboardRoutes.shifts));
  const copy = dictionary.dashboard.shiftPermissions;
  const shifts = dictionary.dashboard.shifts;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const today = calendarDay(circle.circle.now, circle.circle.timezone).occurredOn;
  const caregivers = circle.payees.filter((payee) => payee.caregiverRateCentsPerHour !== null);

  return (
    <>
      <PageHeader
        title={copy.title}
        lede={fill(copy.lede, { parent: names.parent })}
        actions={
          <Link href={localizedPath(locale, dashboardRoutes.shifts)} className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">
            {copy.back}
          </Link>
        }
      />
      {circle.circle.demo ? <p className="max-w-3xl text-sm text-muted-foreground">{copy.simulated}</p> : null}
      {circle.shiftPermissions.length === 0 ? (
        <EmptyState text={copy.empty} />
      ) : (
        <ul className="grid min-w-0 gap-4 lg:grid-cols-2">
          {permissionViews(circle).map((view) => (
            <PermissionCard key={view.permission.id} copy={copy} shifts={shifts} format={format} view={view} caregiver={names.payee(view.permission.payeeId)} parent={names.parent} recordedBy={names.member(view.permission.recordedBy)} />
          ))}
        </ul>
      )}
      {mayGrantShiftPermission(circle) ? (
        <PermissionForm
          locale={locale}
          currency={circle.circle.currency}
          timezone={circle.circle.timezone}
          copy={copy}
          shifts={shifts}
          parent={names.parent}
          caregivers={caregivers.map((payee) => ({ id: payee.id, name: payee.name }))}
          today={today}
          defaultEnd={addDays(today, SUGGESTED_DAYS)}
          playsParent={circle.viewer.role !== "parent"}
        />
      ) : null}
      <CallSettingsSection circle={circle} dictionary={dictionary} names={names} format={format} />
      {may(circle, "shift_rules.manage") && circle.shiftRules.length > 0 ? (
        <Panel title={copy.rules.title} description={copy.rules.text}>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {circle.shiftRules.map((rules) => {
              const payee = caregivers.find((each) => each.id === rules.payeeId);
              return payee ? (
                <PayRulesForm key={rules.payeeId} payeeId={rules.payeeId} heading={fill(copy.rules.rate, { name: payee.name, rate: format.money(payee.caregiverRateCentsPerHour ?? 0) })} rules={rules} copy={copy.rules} shifts={shifts} />
              ) : null;
            })}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
