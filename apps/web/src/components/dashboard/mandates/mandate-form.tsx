"use client";

import { MANDATE_CADENCES, type MandateTerms } from "@kin/domain";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import { aboveUsualNotice, readBack } from "@/content/circle/mandate-words";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";

import { useMandateRequest } from "./use-mandate-request";

type Props = {
  locale: Locale;
  currency: string;
  copy: Dictionary["dashboard"]["mandates"];
  parent: string;
  /** The refill rules a permission can cover, with the seller each buys from. */
  rules: readonly { id: string; item: string; seller: string }[];
  today: string;
  /** The suggested end: a year less a day from today. */
  defaultEnd: string;
  /** In a demo circle the viewer plays the parent's spoken yes, and the screen says so. */
  playsParent: boolean;
};

type Draft = { ruleId: string; perPurchase: string; perPeriod: string; cadence: (typeof MANDATE_CADENCES)[number]; validFrom: string; expiresOn: string; spoken: string };

/**
 * The parent's standing permission, recorded in two steps like a spoken one:
 * the server checks the terms and Kin reads them back in full, and only then
 * is the yes recorded. Nothing is stored by the first step.
 */
export function MandateForm({ locale, currency, copy, parent, rules, today, defaultEnd, playsParent }: Props) {
  const [draft, setDraft] = useState<Draft>({ ruleId: rules[0]?.id ?? "", perPurchase: "", perPeriod: "", cadence: "monthly", validFrom: today, expiresOn: defaultEnd, spoken: "" });
  const [review, setReview] = useState<MandateTerms | null>(null);
  const [aboveUsualCents, setAboveUsualCents] = useState(0);
  const [granted, setGranted] = useState(false);
  const { send, pending, error } = useMandateRequest();
  const router = useRouter();
  const format = formatters(locale, currency);
  const form = copy.form;
  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    setReview(null);
    setGranted(false);
  };
  const rule = rules.find((each) => each.id === draft.ruleId);
  const request = { ruleId: draft.ruleId, perPurchase: draft.perPurchase, perPeriod: draft.perPeriod, cadence: draft.cadence, validFrom: draft.validFrom, expiresOn: draft.expiresOn };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (review === null) {
      const reply = await send({ operation: "review", draft: request });
      if (reply.ok && reply.terms) {
        setReview(reply.terms);
        setAboveUsualCents(reply.aboveUsualCents ?? 0);
      }
      return;
    }
    const reply = await send({ operation: "grant", draft: request, ...(draft.spoken.trim() === "" ? {} : { spokenText: draft.spoken.trim() }) });
    if (reply.ok) {
      setGranted(true);
      setReview(null);
      router.refresh();
    }
  }

  const amount = (key: "perPurchase" | "perPeriod", label: string) => (
    <Field id={`mandate-${key}`} label={label}>
      <input id={`mandate-${key}`} type="text" inputMode="decimal" maxLength={16} required value={draft[key]} aria-describedby="mandate-amount-hint" onChange={(event) => edit({ [key]: event.target.value })} className={inputClass} />
    </Field>
  );

  return (
    <Panel title={form.title} description={fill(form.text, { parent })}>
      <form onSubmit={submit} className="min-w-0 space-y-6" aria-busy={pending}>
        {playsParent ? <p className="text-sm text-muted-foreground">{fill(form.demoNote, { parent })}</p> : null}
        <fieldset disabled={pending || review !== null} className="min-w-0 space-y-4">
          <Field id="mandate-rule" label={form.rule}>
            <select id="mandate-rule" value={draft.ruleId} onChange={(event) => edit({ ruleId: event.target.value })} className={inputClass}>
              {rules.map((each) => (
                <option key={each.id} value={each.id}>{`${each.item} · ${each.seller}`}</option>
              ))}
            </select>
          </Field>
          <p id="mandate-amount-hint" className="text-sm text-muted-foreground">{fill(form.amountHint, { currency })}</p>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {amount("perPurchase", form.perPurchase)}
            {amount("perPeriod", form.perPeriod)}
          </div>
          <Field id="mandate-cadence" label={form.cadence}>
            <select id="mandate-cadence" value={draft.cadence} onChange={(event) => edit({ cadence: MANDATE_CADENCES.find((each) => each === event.target.value) ?? "monthly" })} className={`${inputClass} sm:max-w-xs`}>
              {MANDATE_CADENCES.map((each) => (
                <option key={each} value={each}>{copy.cadences[each]}</option>
              ))}
            </select>
          </Field>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field id="mandate-from" label={form.validFrom}>
              <input id="mandate-from" type="date" required min={today} value={draft.validFrom} onChange={(event) => edit({ validFrom: event.target.value })} className={inputClass} />
            </Field>
            <Field id="mandate-until" label={form.expiresOn}>
              <input id="mandate-until" type="date" required min={today} value={draft.expiresOn} onChange={(event) => edit({ expiresOn: event.target.value })} className={inputClass} />
            </Field>
          </div>
          <Field id="mandate-spoken" label={form.spoken}>
            <textarea id="mandate-spoken" rows={2} maxLength={400} value={draft.spoken} onChange={(event) => setDraft({ ...draft, spoken: event.target.value })} className={`${inputClass} py-2`} />
          </Field>
        </fieldset>
        {review !== null && rule ? (
          <div className="min-w-0 space-y-2 rounded-xl border bg-secondary/40 p-4">
            <h3 className="font-semibold">{form.readBackTitle}</h3>
            <p className="text-pretty">{readBack(copy, format, review, { item: rule.item, seller: rule.seller })}</p>
            {aboveUsualCents > 0 ? (
              <p role="note" className="text-pretty font-medium">{aboveUsualNotice(copy, format, review, parent, aboveUsualCents)}</p>
            ) : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error] ?? copy.errors.unavailable}</p> : null}
        {granted ? <p role="status" className="text-sm text-positive">{form.granted}</p> : null}
        <div className="flex flex-wrap gap-3">
          {review !== null ? (
            <Button type="button" variant="outline" disabled={pending} className="h-auto min-h-11 whitespace-normal" onClick={() => setReview(null)}>
              {form.edit}
            </Button>
          ) : null}
          <Button type="submit" disabled={pending || rules.length === 0} className="h-auto min-h-11 max-w-full whitespace-normal text-start">
            {pending ? (review === null ? form.reviewing : form.granting) : review === null ? form.review : fill(aboveUsualCents > 0 ? copy.aboveUsual.grant : form.grant, { parent })}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
