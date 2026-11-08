"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import type { CaregiverBill } from "@kin/domain";

import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

import { BillBreakdown } from "./bill-breakdown";
import { BillVoice } from "./bill-voice";
import { DescribeVisits } from "./describe-visits";
import { useBillingRequest } from "./use-billing-request";
import { VisitFields, type VisitInput } from "./visit-fields";

type Props = {
  locale: Locale;
  name: string;
  today: string;
  simulated: boolean;
  /** Whether Claude can read a description of the visits on this deployment. */
  canDescribe: boolean;
  /** Kin's voice and listening, when this deployment has them. */
  speech: Dictionary["dashboard"]["speech"] | null;
  copy: Dictionary["dashboard"]["caregiverBilling"];
  /** The words that say who read a description, and the evidence for it. */
  ai: Dictionary["aiProvenance"];
};

/** A bill is reviewed on the server and requires a separate, explicit submission. */
export function BillForm({ locale, name, today, simulated, canDescribe, speech, copy, ai }: Props) {
  const prefix = useId();
  const nextId = useRef(1);
  const [visits, setVisits] = useState<VisitInput[]>([{ id: 0, date: today, hours: "0", minutes: "0" }]);
  const [review, setReview] = useState<{ bill: CaregiverBill; submissionKey: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const { send, pending, error, billId } = useBillingRequest(copy.errors);
  const router = useRouter();
  // The Submit button and a spoken yes both end here.
  async function submitReviewed(reviewed: NonNullable<typeof review>) {
    const result = await send({ operation: "submit", details: reviewed.bill.details, submissionKey: reviewed.submissionKey });
    if (result.ok) { setSubmitted(true); router.refresh(); }
    else if (result.billId) startRefresh(() => router.refresh());
  }
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (review) {
      await submitReviewed(review);
    } else {
      const result = await send({ operation: "review", visits: visits.map((visit) => ({ date: visit.date, minutes: Number(visit.hours) * 60 + Number(visit.minutes) })) });
      if (result.ok && "bill" in result) setReview({ bill: result.bill, submissionKey: result.submissionKey });
    }
  }
  return (
    <Panel title={copy.formTitle} description={copy.formText}>
      {submitted ? <p role="status" className="text-positive">{copy.submitted}</p> : (
        <form onSubmit={handle} className="min-w-0 space-y-4" aria-busy={pending}>
          <p className="font-semibold wrap-anywhere">{name}</p>
          {simulated ? <p className="text-sm text-muted-foreground">{copy.simulated}</p> : null}
          <fieldset disabled={pending} className="min-w-0 space-y-4">
            {review ? (
              <section aria-label={copy.reviewTitle} className="min-w-0 space-y-4">
                <h3 className="font-semibold">{copy.reviewTitle}</h3>
                <BillBreakdown bill={review.bill} locale={locale} copy={copy} />
                {speech ? <BillVoice locale={locale} details={review.bill.details} copy={copy.speech} speech={speech} disabled={pending} onYes={() => void submitReviewed(review)} onNo={() => setReview(null)} /> : null}
              </section>
            ) : (
              <>
                {canDescribe ? (
                  <DescribeVisits
                    locale={locale}
                    speech={speech}
                    copy={copy}
                    ai={ai}
                    disabled={pending}
                    onDescribed={(described) => setVisits(described.map((visit) => ({ id: nextId.current++, date: visit.date, hours: String(Math.floor(visit.minutes / 60)), minutes: String(visit.minutes % 60) })))}
                  />
                ) : null}
                {visits.map((visit) => <VisitFields key={visit.id} visit={visit} prefix={`${prefix}-${visit.id}`} today={today} removable={visits.length > 1} copy={copy} onChange={(value) => setVisits(visits.map((row) => row.id === value.id ? value : row))} onRemove={() => setVisits(visits.filter((row) => row.id !== visit.id))} />)}
                <Button type="button" variant="outline" className="min-h-11" onClick={() => setVisits([...visits, { id: nextId.current++, date: today, hours: "0", minutes: "0" }])}>{copy.addVisit}</Button>
              </>
            )}
          </fieldset>
          {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
          {billId && !refreshing ? <a href={`#caregiver-bill-${billId}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{copy.viewEarlier}</a> : null}
          <div className="flex flex-wrap gap-3">
            {review ? <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => setReview(null)}>{copy.change}</Button> : null}
            <Button type="submit" disabled={pending} className="min-h-11">{pending ? copy.sending : review ? copy.submit : copy.review}</Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
