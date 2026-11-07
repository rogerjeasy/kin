import { calendarDay } from "@kin/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MandateCard } from "@/components/dashboard/mandates/mandate-card";
import { MandateForm } from "@/components/dashboard/mandates/mandate-form";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { circleFormatters } from "@/content/circle/format";
import { addDays } from "@/content/circle/mandate-words";
import { mandateViews, mayGrantMandate } from "@/content/circle/mandates";
import { circleNames } from "@/content/circle/names";
import { circleSlots } from "@/content/circle/words";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { dashboardContext, may } from "@/server/dashboard-context";

// A permission lasts a year at most: the suggested end leaves a day to spare.
const SUGGESTED_DAYS = 364;

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle/mandates">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  return { title: dictionary.dashboard.mandates.title, robots: { index: false, follow: false } };
}

export default async function MandatesPage({ params }: PageProps<"/[locale]/dashboard/circle/mandates">) {
  const { locale, dictionary, circle } = await dashboardContext(params, "circle");
  // A caregiver never sees the family's money: the circle screen is theirs instead.
  if (!may(circle, "money.view")) redirect(localizedPath(locale, dashboardRoutes.circle));
  const copy = dictionary.dashboard.mandates;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const parent = circleSlots(circle, format).parent;
  const views = mandateViews(circle);
  const today = calendarDay(circle.circle.now, circle.circle.timezone).occurredOn;

  return (
    <>
      <PageHeader
        title={copy.title}
        lede={fill(copy.lede, { parent })}
        actions={
          <Link href={localizedPath(locale, dashboardRoutes.approvals)} className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">
            {copy.back}
          </Link>
        }
      />
      {circle.circle.demo ? <p className="max-w-3xl text-sm text-muted-foreground">{copy.simulated}</p> : null}
      {views.length === 0 ? (
        <EmptyState text={copy.empty} />
      ) : (
        <ul className="grid min-w-0 gap-4 lg:grid-cols-2">
          {views.map((view) => (
            <MandateCard key={view.mandate.id} copy={copy} format={format} view={view} seller={names.payee(view.payeeId)} parent={parent} recordedBy={names.member(view.mandate.recordedBy)} />
          ))}
        </ul>
      )}
      {mayGrantMandate(circle) ? (
        <MandateForm
          locale={locale}
          currency={circle.circle.currency}
          copy={copy}
          parent={parent}
          rules={circle.purchaseRules.map((rule) => ({ id: rule.id, item: rule.item, seller: names.payee(rule.payeeId) }))}
          today={today}
          defaultEnd={addDays(today, SUGGESTED_DAYS)}
          playsParent={circle.viewer.role !== "parent"}
        />
      ) : null}
    </>
  );
}
