"use client";

import type { ShiftPermissionTerms } from "@kin/domain";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import { aboveUsualNotice, readBack, type PermissionCopy } from "@/content/circle/shift-permission-words";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";

import { useShiftRequest } from "./use-shift-request";

type Props = {
  locale: Locale;
  currency: string;
  timezone: string;
  copy: PermissionCopy;
  shifts: ShiftCopy;
  parent: string;
  /** The caregivers a permission can cover, by their payee. */
  caregivers: readonly { id: string; name: string }[];
  today: string;
  /** The suggested end: a year less a day from today. */
  defaultEnd: string;
  /** In a demo circle the viewer plays the parent's spoken yes, and the screen says so. */
  playsParent: boolean;
};

type Draft = { payeeId: string; maxHours: string; perShift: string; validFrom: string; expiresOn: string; spoken: string };

/**
 * The parent's standing permission for shifts, recorded in two steps like a
 * spoken one: the server checks the terms and Kin reads them back in full, and
 * only then is the yes recorded. Nothing is stored by the first step.
 */
export function PermissionForm({ locale, currency, timezone, copy, shifts, parent, caregivers, today, defaultEnd, playsParent }: Props) {
  const [draft, setDraft] = useState<Draft>({ payeeId: caregivers[0]?.id ?? "", maxHours: "4", perShift: "", validFrom: today, expiresOn: defaultEnd, spoken: "" });
  const [review, setReview] = useState<ShiftPermissionTerms | null>(null);
  const [aboveUsualCents, setAboveUsualCents] = useState(0);
  const [granted, setGranted] = useState(false);
  const { send, pending, error } = useShiftRequest();
  const router = useRouter();
  const format = formatters(locale, currency, timezone);
  const form = copy.form;
  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    setReview(null);
    setGranted(false);
  };
  const caregiver = caregivers.find((each) => each.id === draft.payeeId);
  const request = { payeeId: draft.payeeId, maxHours: draft.maxHours, perShift: draft.perShift, validFrom: draft.validFrom, expiresOn: draft.expiresOn };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (review === null) {
      const reply = await send({ operation: "review_permission", draft: request });
      if (reply.ok && "terms" in reply) {
        setReview(reply.terms);
        setAboveUsualCents(reply.aboveUsualCents);
      }
      return;
    }
    const reply = await send({ operation: "grant_permission", draft: request, ...(draft.spoken.trim() === "" ? {} : { spokenText: draft.spoken.trim() }) });
    if (reply.ok) {
      setGranted(true);
      setReview(null);
      router.refresh();
    }
  }

  return (
    <Panel title={form.title} description={fill(form.text, { parent })}>
      <form onSubmit={submit} className="min-w-0 space-y-6" aria-busy={pending}>
        {playsParent ? <p className="text-sm text-muted-foreground">{fill(form.demoNote, { parent })}</p> : null}
        <fieldset disabled={pending || review !== null} className="min-w-0 space-y-4">
          <Field id="permission-payee" label={form.payee}>
            <select id="permission-payee" value={draft.payeeId} onChange={(event) => edit({ payeeId: event.target.value })} className={inputClass}>
              {caregivers.map((each) => (
                <option key={each.id} value={each.id}>{each.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field id="permission-hours" label={form.maxHours}>
              <input id="permission-hours" type="text" inputMode="numeric" maxLength={2} required value={draft.maxHours} onChange={(event) => edit({ maxHours: event.target.value })} className={inputClass} />
            </Field>
            <Field id="permission-cap" label={form.perShift} hint={fill(form.amountHint, { currency })}>
              <input id="permission-cap" type="text" inputMode="decimal" maxLength={16} required value={draft.perShift} aria-describedby="permission-cap-hint" onChange={(event) => edit({ perShift: event.target.value })} className={inputClass} />
            </Field>
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field id="permission-from" label={form.validFrom}>
              <input id="permission-from" type="date" required min={today} value={draft.validFrom} onChange={(event) => edit({ validFrom: event.target.value })} className={inputClass} />
            </Field>
            <Field id="permission-until" label={form.expiresOn}>
              <input id="permission-until" type="date" required min={today} value={draft.expiresOn} onChange={(event) => edit({ expiresOn: event.target.value })} className={inputClass} />
            </Field>
          </div>
          <Field id="permission-spoken" label={form.spoken}>
            <textarea id="permission-spoken" rows={2} maxLength={400} value={draft.spoken} onChange={(event) => setDraft({ ...draft, spoken: event.target.value })} className={`${inputClass} py-2`} />
          </Field>
        </fieldset>
        {review !== null && caregiver ? (
          <div className="min-w-0 space-y-2 rounded-xl border bg-secondary/40 p-4">
            <h3 className="font-semibold">{form.readBackTitle}</h3>
            <p className="text-pretty">{readBack(copy, shifts, format, review, caregiver.name)}</p>
            {aboveUsualCents > 0 ? <p role="note" className="text-pretty font-medium">{aboveUsualNotice(copy, shifts, format, review, parent, aboveUsualCents)}</p> : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-danger">{failureText(shifts, error)}</p> : null}
        {granted ? <p role="status" className="text-sm text-positive">{form.granted}</p> : null}
        {caregivers.length === 0 ? <p className="text-sm text-muted-foreground">{form.noCaregiver}</p> : null}
        <div className="flex flex-wrap gap-3">
          {review !== null ? (
            <Button type="button" variant="outline" disabled={pending} className="h-auto min-h-11 whitespace-normal" onClick={() => setReview(null)}>
              {form.edit}
            </Button>
          ) : null}
          <Button type="submit" disabled={pending || caregivers.length === 0} className="h-auto min-h-11 max-w-full whitespace-normal text-start">
            {pending ? (review === null ? form.reviewing : form.granting) : review === null ? form.review : fill(aboveUsualCents > 0 ? copy.aboveUsual.grant : form.grant, { parent })}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
