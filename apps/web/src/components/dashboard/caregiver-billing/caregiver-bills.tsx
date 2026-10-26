import { caregiverAccess } from "@kin/auth";
import { calendarDay } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import type { Viewer } from "@/server/viewer";
import { BillForm } from "./bill-form";
import { SubmittedBills } from "./submitted-bills";

type Props = { circle: CircleSnapshot; viewer: Viewer; locale: Locale; copy: Dictionary["dashboard"]["caregiverBilling"] };

export function CaregiverBills({ circle, viewer, locale, copy }: Props) {
  const account = viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes;
  const seat = { role: circle.viewer.role, status: "active" } as const;
  const canSubmit = caregiverAccess(seat, "caregiver_bill.submit", account);
  const canReview = caregiverAccess(seat, "caregiver_bill.review", account);
  const payee = circle.payees.find((each) => each.payee.member?.memberId === circle.viewer.memberId && each.caregiverRateCentsPerHour !== null);
  return (
    <>
      {canSubmit ? payee ? <BillForm locale={locale} name={payee.name} today={calendarDay(circle.circle.now, circle.circle.timezone).occurredOn} simulated={circle.circle.demo} copy={copy} /> : <Panel title={copy.formTitle}><p>{copy.missingRate}</p></Panel> : null}
      <SubmittedBills circle={circle} locale={locale} canReview={canReview} copy={copy} />
    </>
  );
}
