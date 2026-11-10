"use client";

import { AGREEMENT_FOOTER, CARE_END_TERMS, CARE_PAYERS, CARE_RELATIONS, US_STATES } from "@kin/domain";
import { AlertTriangleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { CareAgreementPreview } from "@/server/care-agreement";

import { AgreementText } from "./agreement-text";
import { useCareAgreementRequest } from "./use-care-agreement-request";

/** A caregiver with a pay rate, shown as money: the agreement states this rate, and the server reads it from the record again. */
type Caregiver = { readonly payeeId: string; readonly name: string; readonly rate: string };

type Props = {
  copy: Dictionary["dashboard"]["careAgreements"];
  caregivers: readonly Caregiver[];
  today: string;
};

type Draft = {
  payeeId: string;
  relation: string;
  duties: string;
  hours: string;
  startsOn: string;
  endTerm: string;
  endsOn: string;
  payer: string;
  state: string;
};

const radioClass = "size-5 shrink-0 accent-primary";

/**
 * An organizer writes a care agreement. The server fills a fixed template and
 * says how the rate compares with the market; only after reading it can the
 * draft be saved. Saving asks for signatures and changes no payment yet. The
 * rate is the caregiver's pay rate, shown and never typed: the agreement
 * states the rate Kin pays.
 */
export function CareAgreementForm({ copy, caregivers, today }: Props) {
  const [first] = caregivers;
  const [draft, setDraft] = useState<Draft>({ payeeId: first?.payeeId ?? "", relation: "not_related", duties: "", hours: "20", startsOn: today, endTerm: "either_party_30_days", endsOn: "", payer: "care_recipient", state: "NY" });
  const [preview, setPreview] = useState<CareAgreementPreview | null>(null);
  const { send, pending, error } = useCareAgreementRequest();
  const router = useRouter();
  const form = copy.form;
  const spouse = draft.relation === "spouse";
  const chosen = caregivers.find((each) => each.payeeId === draft.payeeId);

  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    setPreview(null);
  };
  const request = () => ({ ...draft, endsOn: draft.endTerm === "fixed_end_date" ? draft.endsOn : null });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview === null) {
      const reply = await send({ operation: "review", draft: request() });
      if (reply.ok && reply.preview) setPreview(reply.preview);
      return;
    }
    const reply = await send({ operation: "propose", draft: request() });
    if (reply.ok) {
      setPreview(null);
      setDraft({ ...draft, duties: "" });
      router.refresh();
    }
  }

  return (
    <Panel title={form.title} description={form.text}>
      <form onSubmit={submit} className="min-w-0 space-y-6" aria-busy={pending}>
        <fieldset disabled={pending || preview !== null} className="min-w-0 space-y-5">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field id="ca-caregiver" label={form.caregiver}>
              <select
                id="ca-caregiver"
                value={draft.payeeId}
                onChange={(event) => edit({ payeeId: event.target.value })}
                className={inputClass}
              >
                {caregivers.map((each) => (
                  <option key={each.payeeId} value={each.payeeId}>
                    {each.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="ca-relation" label={form.relation}>
              <select id="ca-relation" value={draft.relation} onChange={(event) => edit({ relation: event.target.value })} className={inputClass}>
                {CARE_RELATIONS.map((relation) => (
                  <option key={relation} value={relation}>
                    {form.relations[relation]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {spouse ? (
            <p role="alert" className="flex items-start gap-2 rounded-2xl border border-highlight/40 bg-highlight/10 p-3.5 text-sm">
              <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
              <span className="min-w-0">{form.spouseWarning}</span>
            </p>
          ) : null}
          <Field id="ca-duties" label={form.duties} hint={form.dutiesHint}>
            <textarea id="ca-duties" required rows={5} maxLength={2400} value={draft.duties} aria-describedby="ca-duties-hint" onChange={(event) => edit({ duties: event.target.value })} className={`${inputClass} py-2`} />
          </Field>
          <div className="grid min-w-0 items-start gap-4 sm:grid-cols-3">
            <Field id="ca-hours" label={form.hours}>
              <input id="ca-hours" type="text" inputMode="numeric" required maxLength={2} value={draft.hours} onChange={(event) => edit({ hours: event.target.value })} className={inputClass} />
            </Field>
            <Field id="ca-rate" label={form.rate} hint={fill(form.rateFixed, { name: chosen?.name ?? "" })}>
              <input id="ca-rate" type="text" readOnly value={chosen?.rate ?? ""} aria-describedby="ca-rate-hint" className={`${inputClass} bg-secondary/40`} />
            </Field>
            <Field id="ca-start" label={form.start}>
              <input id="ca-start" type="date" required value={draft.startsOn} onChange={(event) => edit({ startsOn: event.target.value })} className={inputClass} />
            </Field>
          </div>
          <fieldset className="min-w-0 space-y-2">
            <legend className="font-medium">{form.endTerm}</legend>
            {CARE_END_TERMS.map((term) => (
              <label key={term} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-card px-3.5 py-2 transition-[border-color,background-color,box-shadow] duration-300 hover:border-input has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:checked]:shadow-[0_0_0_3px_rgb(var(--glow-gold)/0.18)] sm:max-w-md">
                <input type="radio" name="ca-end" className={radioClass} checked={draft.endTerm === term} onChange={() => edit({ endTerm: term })} />
                <span className="min-w-0">{form.endTerms[term]}</span>
              </label>
            ))}
            {draft.endTerm === "fixed_end_date" ? (
              <Field id="ca-ends" label={form.endsOn}>
                <input id="ca-ends" type="date" required min={draft.startsOn} value={draft.endsOn} onChange={(event) => edit({ endsOn: event.target.value })} className={`${inputClass} sm:max-w-xs`} />
              </Field>
            ) : null}
          </fieldset>
          <fieldset className="min-w-0 space-y-2">
            <legend className="font-medium">{form.payer}</legend>
            {CARE_PAYERS.map((payer) => (
              <label key={payer} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-card px-3.5 py-2 transition-[border-color,background-color,box-shadow] duration-300 hover:border-input has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:checked]:shadow-[0_0_0_3px_rgb(var(--glow-gold)/0.18)] sm:max-w-md">
                <input type="radio" name="ca-payer" className={radioClass} checked={draft.payer === payer} onChange={() => edit({ payer })} />
                <span className="min-w-0">{form.payers[payer]}</span>
              </label>
            ))}
          </fieldset>
          <Field id="ca-state" label={form.state}>
            <select id="ca-state" value={draft.state} onChange={(event) => edit({ state: event.target.value })} className={`${inputClass} sm:max-w-xs`}>
              {US_STATES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>
        {preview !== null ? (
          <div className="enter space-y-4 rounded-2xl border bg-secondary/50 p-4 shadow-xs sm:p-6">
            <p className="text-sm font-medium">{fill(copy.rateNote[preview.rate.judgement], { rate: preview.rate.rate, median: preview.rate.median ?? "" })}</p>
            <h3 className="font-semibold">{form.previewTitle}</h3>
            <AgreementText clauses={preview.clauses} footer={AGREEMENT_FOOTER} />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {copy.errors[error] ?? copy.errors.unavailable}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {preview !== null ? (
            <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => setPreview(null)}>
              {form.back}
            </Button>
          ) : null}
          <Button type="submit" disabled={pending || spouse} className="min-h-11">
            {preview === null ? form.review : form.propose}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
