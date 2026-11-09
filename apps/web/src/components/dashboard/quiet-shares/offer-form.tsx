"use client";

import { addMonths } from "@kin/domain";
import { LockIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";
import type { DraftForm } from "@/server/quiet-shares";

import type { QuietScreen } from "./quiet-screen";
import { useQuietShare } from "./use-quiet-share";

type Props = { screen: QuietScreen; askId: string; startMonth: string; sealsLeft: number; draft: DraftForm; onChange: (draft: DraftForm) => void; onSealed: () => void; aside?: ReactNode };

const MONTHS_AHEAD = 12;

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="font-medium">{label}</label>
      {hint ? <p id={`${id}-hint`} className="text-sm text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  );
}

/**
 * The offer the person seals, as their agent drafted it or as they type it.
 * Every field is theirs to change; the server reads each amount again, digit
 * by digit, and checks it before the database seals it for them alone.
 */
export function OfferForm({ screen, askId, startMonth, sealsLeft, draft, onChange, onSealed, aside }: Props) {
  const { copy } = screen;
  const words = copy.offer;
  const id = useId();
  const format = formatters(screen.locale, screen.currency, screen.timezone);
  const { send, pending, error } = useQuietShare(screen.seat);
  const set = (key: keyof DraftForm) => (event: { target: { value: string } }) => onChange({ ...draft, [key]: event.target.value });
  const later = Array.from({ length: MONTHS_AHEAD }, (_, index) => addMonths(startMonth, index + 1));

  async function seal() {
    const reply = await send({ operation: "seal", askId, offer: draft });
    if (reply.ok) onSealed();
  }

  return (
    <form
      aria-labelledby={`${id}-title`}
      className="@container min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void seal();
      }}
    >
      <div className="min-w-0">
        <h4 id={`${id}-title`} className="text-base font-semibold">{words.title}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{words.text}</p>
      </div>
      <div className="grid min-w-0 gap-4 @md:grid-cols-2">
        <Field id={`${id}-monthly`} label={words.monthly} hint={words.monthlyHint}>
          <input id={`${id}-monthly`} aria-describedby={`${id}-monthly-hint`} inputMode="decimal" autoComplete="off" maxLength={12} value={draft.monthly} disabled={pending} onChange={set("monthly")} className={`${inputClass} text-lg`} />
        </Field>
        <Field id={`${id}-earliest`} label={words.earliest}>
          <select id={`${id}-earliest`} value={draft.earliestMonth} disabled={pending} onChange={set("earliestMonth")} className={inputClass}>
            <option value="">{words.anyMonth}</option>
            {later.map((month) => (
              <option key={month} value={month}>{format.month(month)}</option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-step`} label={words.stepUp} hint={words.stepUpHint}>
          <input id={`${id}-step`} aria-describedby={`${id}-step-hint`} inputMode="decimal" autoComplete="off" maxLength={12} value={draft.stepUp} disabled={pending} onChange={set("stepUp")} className={inputClass} />
        </Field>
        <Field id={`${id}-step-month`} label={words.stepUpMonth}>
          <select id={`${id}-step-month`} value={draft.stepUpMonth} disabled={pending} onChange={set("stepUpMonth")} className={inputClass}>
            <option value="">{words.anyMonth}</option>
            {later.map((month) => (
              <option key={month} value={month}>{format.month(month)}</option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-trips`} label={words.careTrips}>
          <input id={`${id}-trips`} inputMode="numeric" autoComplete="off" maxLength={2} value={draft.careTrips} disabled={pending} onChange={set("careTrips")} className={inputClass} />
        </Field>
        <Field id={`${id}-hours`} label={words.careHours}>
          <input id={`${id}-hours`} inputMode="decimal" autoComplete="off" maxLength={5} value={draft.careHours} disabled={pending} onChange={set("careHours")} className={inputClass} />
        </Field>
      </div>
      <p className="text-sm text-muted-foreground">{words.careHint}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || sealsLeft === 0} className="h-auto min-h-12 max-w-full whitespace-normal">
          <LockIcon aria-hidden="true" />
          {pending ? words.sealing : words.seal}
        </Button>
        {aside}
      </div>
      <p className="text-sm text-muted-foreground">{fill(words.sealsLeft, { count: format.count(sealsLeft) })}</p>
      {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
    </form>
  );
}
