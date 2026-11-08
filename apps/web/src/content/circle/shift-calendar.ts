import type { CalendarEvent, CalendarResource } from "@/components/dashboard/shifts/care-calendar-types";

import type { CircleNames } from "./names";
import type { ShiftView } from "./shift-views";
import type { ShiftCopy } from "./shift-words";

/** The week's shifts as the calendar draws them: one row per person, one block per shift, every word translated. */
export function calendarData(views: readonly ShiftView[], copy: ShiftCopy, names: CircleNames): { resources: CalendarResource[]; events: CalendarEvent[] } {
  const people = [...new Set(views.map((view) => view.shift.memberId))];
  return {
    resources: people.map((id) => ({ id, name: names.member(id) })),
    events: views.map(({ shift, tone, chip }) => ({
      id: shift.id,
      resourceId: shift.memberId,
      title: shift.title ?? copy.kinds[shift.kind],
      startsAt: shift.startsAt.toISOString(),
      endsAt: shift.endsAt.toISOString(),
      tone,
      statusText: copy.chips[chip],
    })),
  };
}
