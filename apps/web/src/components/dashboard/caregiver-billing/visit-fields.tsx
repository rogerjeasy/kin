"use client";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

export type VisitInput = { readonly id: number; readonly date: string; readonly hours: string; readonly minutes: string };
type Props = { visit: VisitInput; prefix: string; today: string; removable: boolean; copy: Dictionary["dashboard"]["caregiverBilling"]; onChange: (value: VisitInput) => void; onRemove: () => void };

export function VisitFields({ visit, prefix, today, removable, copy, onChange, onRemove }: Props) {
  return (
    <div className="grid min-w-0 gap-3 rounded-xl border p-4 sm:grid-cols-3">
      <Field id={`${prefix}-date`} label={copy.date}>
        <input id={`${prefix}-date`} type="date" required max={today} value={visit.date} onChange={(event) => onChange({ ...visit, date: event.target.value })} className={inputClass} />
      </Field>
      <Field id={`${prefix}-hours`} label={copy.hours}>
        <input id={`${prefix}-hours`} type="number" min="0" max="24" step="1" required inputMode="numeric" value={visit.hours} onChange={(event) => onChange({ ...visit, hours: event.target.value })} className={inputClass} />
      </Field>
      <Field id={`${prefix}-minutes`} label={copy.minutes}>
        <input id={`${prefix}-minutes`} type="number" min="0" max="59" step="1" required inputMode="numeric" value={visit.minutes} onChange={(event) => onChange({ ...visit, minutes: event.target.value })} className={inputClass} />
      </Field>
      {removable ? <Button type="button" variant="ghost" className="min-h-11 justify-self-start" onClick={onRemove}>{copy.removeVisit}</Button> : null}
    </div>
  );
}
