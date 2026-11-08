"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import type { PermissionCopy } from "@/content/circle/shift-permission-words";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";

import { useShiftRequest } from "./use-shift-request";

type Props = {
  payeeId: string;
  /** "Amara, $22.00 an hour", already worded. */
  heading: string;
  rules: { readonly minimumMinutes: number; readonly overtimeAfterMinutes: number | null; readonly overtimePercent: number };
  copy: PermissionCopy["rules"];
  shifts: ShiftCopy;
};

const MINUTES_PER_HOUR = 60;

/**
 * One caregiver's pay rules: the least a visit is paid for, and when overtime
 * starts and what it pays. Only an organizer may, which the server and the
 * database check; this form sends whole numbers and nothing else.
 */
export function PayRulesForm({ payeeId, heading, rules, copy, shifts }: Props) {
  const [saved, setSaved] = useState(false);
  const { send, pending, error } = useShiftRequest();
  const router = useRouter();
  const id = `rules-${payeeId}`;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const data = new FormData(event.currentTarget);
    const after = String(data.get("overtimeAfterHours") ?? "").trim();
    const reply = await send({
      operation: "rules",
      payeeId,
      minimumMinutes: Number(String(data.get("minimumMinutes")).trim()),
      overtimeAfterHours: after === "" ? null : Number(after),
      overtimePercent: Number(String(data.get("overtimePercent")).trim()),
    });
    if (reply.ok) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={save} aria-labelledby={`${id}-heading`} className="min-w-0 space-y-4 rounded-xl border p-4" aria-busy={pending}>
      <h3 id={`${id}-heading`} className="font-semibold">{heading}</h3>
      <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-3">
        <Field id={`${id}-minimum`} label={copy.minimum}>
          <input id={`${id}-minimum`} name="minimumMinutes" type="number" inputMode="numeric" min={0} max={1440} step={1} required defaultValue={rules.minimumMinutes} className={inputClass} />
        </Field>
        <Field id={`${id}-after`} label={copy.overtimeAfter}>
          <input id={`${id}-after`} name="overtimeAfterHours" type="number" inputMode="numeric" min={1} max={24} step={1} defaultValue={rules.overtimeAfterMinutes === null ? "" : rules.overtimeAfterMinutes / MINUTES_PER_HOUR} className={inputClass} />
        </Field>
        <Field id={`${id}-percent`} label={copy.overtimePercent}>
          <input id={`${id}-percent`} name="overtimePercent" type="number" inputMode="numeric" min={100} max={300} step={1} required defaultValue={rules.overtimePercent} className={inputClass} />
        </Field>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-danger">{failureText(shifts, error)}</p> : null}
      {saved ? <p role="status" className="text-sm text-positive">{copy.saved}</p> : null}
      <Button type="submit" disabled={pending} className="min-h-11">
        {pending ? copy.saving : copy.save}
      </Button>
    </form>
  );
}
