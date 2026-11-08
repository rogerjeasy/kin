"use client";

import { CheckCircle2Icon, UserRoundCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { useShiftRequest } from "./use-shift-request";

type Kind = "aide" | "visit";

/** One cancelled shift and the people who could cover it, every word already in the viewer's language. */
export type CoverItem = {
  readonly shiftId: string;
  readonly heading: string;
  readonly title: string | null;
  readonly note: { readonly text: string; readonly badge: ReactNode } | null;
  readonly people: readonly { readonly memberId: string; readonly name: string; readonly kind: Kind; readonly kindText: string; readonly hoursDay: string; readonly hoursWeek: string; readonly button: string }[];
  /** The cancelled shift's day and clock times on the circle's calendar; `null` when it runs past midnight. */
  readonly window: { readonly date: string; readonly start: string; readonly end: string } | null;
  readonly timezone: string;
};

type Props = { item: CoverItem; copy: ShiftCopy; cover: Dictionary["dashboard"]["shiftCover"]; doneName: string | null; onDone: (name: string) => void };

/**
 * Asking someone to cover puts them on the calendar for the same window,
 * through the ordinary scheduling operation: the server allows it only to
 * those who may schedule, and a person has to press the button.
 */
export function CoverCard({ item, copy, cover, doneName, onDone }: Props) {
  const { send, pending, error } = useShiftRequest();
  const router = useRouter();

  async function ask(person: CoverItem["people"][number]) {
    if (item.window === null) return;
    const reply = await send({ operation: "schedule", id: crypto.randomUUID(), kind: person.kind, memberId: person.memberId, ...(item.title === null ? {} : { title: item.title }), ...item.window });
    if (!reply.ok) return;
    onDone(person.name);
    router.refresh();
  }

  if (doneName !== null) {
    return (
      <li className="min-w-0 rounded-2xl border-2 border-positive/40 bg-positive/5 p-5 sm:p-6">
        <div role="status" className="flex min-w-0 items-start gap-3">
          <CheckCircle2Icon aria-hidden="true" className="mt-1 size-7 shrink-0 text-positive" />
          <p className="min-w-0 text-lg font-semibold text-pretty">{fill(cover.done, { name: doneName })}</p>
        </div>
      </li>
    );
  }

  return (
    <li className="min-w-0 space-y-4 rounded-2xl border-2 border-highlight/50 bg-highlight/5 p-5 shadow-xs sm:p-6">
      <div className="flex min-w-0 items-start gap-3">
        <UserRoundCheckIcon aria-hidden="true" className="mt-1.5 size-7 shrink-0 text-highlight" />
        <h3 className="min-w-0 font-serif text-xl leading-snug text-balance sm:text-2xl">{item.heading}</h3>
      </div>
      {item.note ? (
        <div className="min-w-0 space-y-2">
          <p className="text-base text-pretty">{item.note.text}</p>
          {item.note.badge}
        </div>
      ) : null}
      {item.people.length === 0 ? (
        <p className="text-base text-pretty text-muted-foreground">{cover.nobody}</p>
      ) : (
        <ul aria-label={cover.candidates} className="min-w-0 space-y-3">
          {item.people.map((person) => (
            <li key={person.memberId} className="min-w-0 space-y-2 rounded-xl border bg-card p-4">
              <p className="min-w-0 font-semibold wrap-anywhere">{person.name}</p>
              <p className="text-sm text-muted-foreground">{person.kindText}</p>
              <p className="text-sm text-muted-foreground">{person.hoursDay}. {person.hoursWeek}.</p>
              <Button type="button" disabled={pending || item.window === null} onClick={() => ask(person)} className="h-auto min-h-11 w-full whitespace-normal px-4 py-2 sm:w-auto">
                {pending ? cover.asking : person.button}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="text-base text-danger">{failureText(copy, error)}</p> : null}
    </li>
  );
}
