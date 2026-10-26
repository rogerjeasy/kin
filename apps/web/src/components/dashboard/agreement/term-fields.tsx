"use client";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import type { Draft } from "./draft";

type Props = {
  copy: Dictionary["dashboard"]["agreement"]["form"];
  draft: Draft;
  parent: string;
  currency: string;
  today: string;
  onChange: (change: Partial<Draft>) => void;
};

const checkboxClass = "size-5 shrink-0 accent-primary";

/** Care time, the three approval amounts, and the start date. */
export function TermFields({ copy, draft, parent, currency, today, onChange }: Props) {
  const amountHint = fill(copy.amountHint, { currency });
  // One hint per group, read with each of its amounts.
  const amount = (id: keyof Pick<Draft, "parent" | "second" | "ceiling" | "careRate">, label: string, hintId: string) => (
    <Field id={`term-${id}`} label={label}>
      <input id={`term-${id}`} type="text" inputMode="decimal" maxLength={16} required value={draft[id]} aria-describedby={hintId} onChange={(event) => onChange({ [id]: event.target.value })} className={inputClass} />
    </Field>
  );
  return (
    <>
      <fieldset className="min-w-0 space-y-4">
        <legend className="font-semibold">{copy.careLegend}</legend>
        <p id="care-hint" className="text-sm text-muted-foreground">{fill(copy.currencyHint, { currency })}</p>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={draft.careOn} onChange={(event) => onChange({ careOn: event.target.checked, careCash: event.target.checked && draft.careCash })} className={checkboxClass} />
          <span>{copy.careCounts}</span>
        </label>
        {draft.careOn ? (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {amount("careRate", copy.careRate, "care-hint")}
            <label className="flex min-h-11 items-center gap-3 self-end">
              <input type="checkbox" checked={draft.careCash} onChange={(event) => onChange({ careCash: event.target.checked })} className={checkboxClass} />
              <span>{copy.careCash}</span>
            </label>
          </div>
        ) : null}
      </fieldset>
      <fieldset className="min-w-0 space-y-4">
        <legend className="font-semibold">{copy.approvalsLegend}</legend>
        <p id="approvals-hint" className="text-sm text-muted-foreground">{amountHint}</p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          {amount("parent", fill(copy.parentAbove, { parent }), "approvals-hint")}
          {amount("second", copy.secondAbove, "approvals-hint")}
          {amount("ceiling", copy.ceiling, "approvals-hint")}
        </div>
      </fieldset>
      <Field id="term-effective" label={copy.effectiveOn}>
        <input id="term-effective" type="date" required min={today} value={draft.effectiveOn} onChange={(event) => onChange({ effectiveOn: event.target.value })} className={`${inputClass} sm:max-w-xs`} />
      </Field>
    </>
  );
}
