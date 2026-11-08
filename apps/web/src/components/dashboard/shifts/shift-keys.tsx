import { CheckCircle2Icon, CircleIcon } from "lucide-react";

import type { ShiftView } from "@/content/circle/shift-views";
import type { ShiftCopy } from "@/content/circle/shift-words";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = { view: ShiftView; copy: ShiftCopy; format: Formatters; caregiver: string; familyName: string | null };

function Step({ done, label, detail, doneLabel }: { done: boolean; label: string; detail: string; doneLabel: string }) {
  return (
    <li className="flex min-w-0 items-start gap-2">
      {done ? <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-positive" /> : <CircleIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0">
        <p className={cn("text-sm font-medium text-pretty", !done && "text-muted-foreground")}>
          {done ? <span className="sr-only">{doneLabel}: </span> : null}
          {label}
        </p>
        <p className="text-sm text-muted-foreground text-pretty">{detail}</p>
      </div>
    </li>
  );
}

/** The two keys that prove a visit, side by side: the caregiver's own taps and the family's word. */
export function ShiftKeys({ view, copy, format, caregiver, familyName }: Props) {
  const { shift, keys } = view;
  const { keys: words } = copy;
  const taps =
    shift.checkedInAt === null
      ? words.todo
      : shift.checkedOutAt === null
        ? fill(words.in, { start: format.time(shift.checkedInAt) })
        : fill(words.inOut, { start: format.time(shift.checkedInAt), end: format.time(shift.checkedOutAt) });
  const said = shift.familyConfirmedAt === null ? words.todo : fill(words.saidBy, { name: familyName ?? "", time: format.time(shift.familyConfirmedAt) });
  return (
    <ol className="grid min-w-0 gap-3 sm:grid-cols-2">
      <Step done={keys.caregiver} label={fill(words.caregiver, { name: caregiver })} detail={taps} doneLabel={words.done} />
      <Step done={keys.family} label={words.family} detail={said} doneLabel={words.done} />
    </ol>
  );
}
