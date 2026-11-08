"use client";

import { SHIFT_KINDS, type ShiftKind } from "@kin/domain";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";
import { fill } from "@/i18n/template";

import { useShiftRequest } from "./use-shift-request";

export type SchedulePerson = { readonly id: string; readonly name: string };

type Props = {
  copy: ShiftCopy;
  timezone: string;
  /** Who can take each kind of shift: an aide shift only a caregiver with a rate, the others any member who is not an observer. */
  people: Readonly<Record<ShiftKind, readonly SchedulePerson[]>>;
  today: string;
};

/**
 * Puts a shift on the calendar. The day and times are the circle's own wall
 * clock: the server turns them into instants on the circle's calendar, never
 * by anything the browser knows of its own zone.
 */
export function ScheduleForm({ copy, timezone, people, today }: Props) {
  const form = copy.schedule;
  const [kind, setKind] = useState<ShiftKind>("aide");
  const [done, setDone] = useState(false);
  const { send, pending, error } = useShiftRequest();
  const router = useRouter();
  const options = people[kind];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(false);
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const reply = await send({
      operation: "schedule",
      // One ID per tap of the button's form, so a double tap schedules once.
      id: crypto.randomUUID(),
      kind,
      memberId: data.get("memberId"),
      ...(title === "" ? {} : { title }),
      date: data.get("date"),
      start: data.get("start"),
      end: data.get("end"),
    });
    if (reply.ok) {
      setDone(true);
      router.refresh();
    }
  }

  return (
    <Panel title={form.title} description={fill(form.text, { timezone })}>
      <form onSubmit={submit} className="min-w-0 space-y-4" aria-busy={pending}>
        <fieldset disabled={pending} className="min-w-0 space-y-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field id="shift-kind" label={form.kind}>
              <select id="shift-kind" value={kind} onChange={(event) => setKind(SHIFT_KINDS.find((each) => each === event.target.value) ?? "aide")} className={inputClass}>
                {SHIFT_KINDS.map((each) => (
                  <option key={each} value={each}>{copy.kinds[each]}</option>
                ))}
              </select>
            </Field>
            <Field id="shift-person" label={form.person}>
              <select id="shift-person" name="memberId" required disabled={options.length === 0} key={kind} className={inputClass}>
                {options.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field id="shift-title" label={form.label}>
            <input id="shift-title" name="title" type="text" maxLength={80} className={inputClass} />
          </Field>
          <div className="grid min-w-0 gap-4 sm:grid-cols-3">
            <Field id="shift-date" label={form.date}>
              <input id="shift-date" name="date" type="date" required defaultValue={today} className={inputClass} />
            </Field>
            <Field id="shift-start" label={form.start}>
              <input id="shift-start" name="start" type="time" required defaultValue="09:00" className={inputClass} />
            </Field>
            <Field id="shift-end" label={form.end}>
              <input id="shift-end" name="end" type="time" required defaultValue="13:00" className={inputClass} />
            </Field>
          </div>
        </fieldset>
        {options.length === 0 ? <p className="text-sm text-muted-foreground">{form.nobody}</p> : null}
        {error ? <p role="alert" className="text-sm text-danger">{failureText(copy, error)}</p> : null}
        {done ? <p role="status" className="text-sm text-positive">{form.done}</p> : null}
        <Button type="submit" disabled={pending || options.length === 0} className="min-h-11">
          {pending ? form.submitting : form.submit}
        </Button>
      </form>
    </Panel>
  );
}
