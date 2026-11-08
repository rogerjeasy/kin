import type { EventTooltipConfig, SchedulerConfig } from "@bryntum/scheduler";

import { eventAccessibleName, TONE_ICON } from "./care-calendar-model.ts";
import type { CalendarEvent } from "./care-calendar-types.ts";

type EventContext = Parameters<NonNullable<SchedulerConfig["eventRenderer"]>>[0];
type TooltipContext = Parameters<NonNullable<EventTooltipConfig["template"]>>[0];

/** The shifts by id: the scheduler's records hold only what it draws, and the words come from here. */
export type ShiftsById = ReadonlyMap<string, CalendarEvent>;

function timeRange(shift: CalendarEvent, locale: string, timezone: string): string {
  const day = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "long", hour: "numeric", minute: "2-digit" });
  const time = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  return `${day.format(new Date(shift.startsAt))} - ${time.format(new Date(shift.endsAt))}`;
}

/** What a shift's bar says: its title and its status in words, and the name a screen reader reads. */
export function eventRenderer(shifts: ShiftsById, locale: string, timezone: string) {
  return ({ eventRecord, renderData }: EventContext) => {
    const shift = shifts.get(String(eventRecord.id));
    if (!shift) return "";
    renderData.ariaLabel = eventAccessibleName(shift, locale, timezone);
    renderData.iconCls = `fa ${TONE_ICON[shift.tone]}`;
    return {
      className: "care-shift-text",
      children: [
        { className: "care-shift-title", text: shift.title },
        { className: "care-shift-status", text: shift.statusText },
      ],
    };
  };
}

/** The tooltip: the same three facts, whole. Built from text nodes, so nothing in a title is read as markup. */
export function eventTooltip(shifts: ShiftsById, locale: string, timezone: string): EventTooltipConfig {
  return {
    cls: "care-tooltip",
    template: ({ eventRecord }: TooltipContext) => {
      const shift = shifts.get(String(eventRecord.id));
      return {
        className: "care-tooltip-body",
        children: shift
          ? [
              { tag: "strong", text: shift.title },
              { tag: "div", text: timeRange(shift, locale, timezone) },
              { tag: "div", text: shift.statusText },
            ]
          : [],
      };
    },
  };
}
