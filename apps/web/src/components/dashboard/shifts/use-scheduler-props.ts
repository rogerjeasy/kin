import { Scheduler } from "@bryntum/scheduler";
import type { BryntumSchedulerProps } from "@bryntum/scheduler-react";
import { useMemo } from "react";

import { READ_ONLY_STORES, assistantFeature } from "./care-calendar-assistant.ts";
import { calendarHeight, nameColumn, staticOptions } from "./care-calendar-options.ts";
import { stackDepths, toSchedulerEvent, visibleHours, weekRange } from "./care-calendar-model.ts";
import { eventRenderer, eventTooltip } from "./care-calendar-render.ts";
import { NOW_ID, scrollToWhatMatters } from "./care-calendar-scroll.ts";
import type { CareCalendarProps } from "./care-calendar-types.ts";

const ACTIVATION_KEYS: ReadonlySet<string> = new Set(["Enter", " "]);

/**
 * The scheduler's settings for what the calendar was given. Every value is
 * memoised: the wrapper compares props by identity and reloads on a new one.
 */
export function useSchedulerProps(props: CareCalendarProps): BryntumSchedulerProps {
  const { resources, events, weekStart, timezone, locale, dir, now, onSelect, label, assistant } = props;
  // Bryntum 7.3.8 overflows the stack while building the assistant in a right-to-left locale, which would
  // leave Arabic and Hebrew readers with the plain-text list instead of the calendar. The assistant waits for a fix.
  const aiFeature = useMemo(() => (assistant && dir === "ltr" ? assistantFeature(locale) : undefined), [assistant, dir, locale]);
  const range = useMemo(() => weekRange(weekStart, timezone), [weekStart, timezone]);
  const hours = useMemo(() => visibleHours(events, timezone, range), [events, timezone, range]);
  const shifts = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);

  const workingTime = useMemo(() => (hours.fromHour === 0 && hours.toHour === 24 ? undefined : hours), [hours]);
  const rows = useMemo(() => resources.map(({ id, name }) => ({ id, name })), [resources]);
  const records = useMemo(() => events.map(toSchedulerEvent), [events]);
  const nowLine = useMemo(() => [{ id: NOW_ID, startDate: new Date(now), duration: 0, name: "", cls: "care-now" }], [now]);
  const height = useMemo(() => calendarHeight(stackDepths(resources, events)), [resources, events]);
  const columns = useMemo(() => nameColumn(label), [label]);
  const renderer = useMemo(() => eventRenderer(shifts, locale, timezone), [shifts, locale, timezone]);
  const tooltip = useMemo(() => eventTooltip(shifts, locale, timezone), [shifts, locale, timezone]);

  return {
    ...staticOptions,
    ...(aiFeature ? { aiFeature, ...READ_ONLY_STORES } : {}),
    ariaLabel: label,
    rtl: dir === "rtl",
    timeZone: timezone,
    startDate: range.start,
    endDate: range.end,
    workingTime,
    height,
    columns,
    resources: rows,
    events: records,
    timeRanges: nowLine,
    eventRenderer: renderer,
    eventTooltipFeature: tooltip,
    onPaint: ({ source, firstPaint }) => {
      if (firstPaint && source instanceof Scheduler) scrollToWhatMatters(source);
    },
    onEventClick: ({ eventRecord }) => onSelect?.(String(eventRecord.id)),
    onEventKeyDown: ({ eventRecords, event }) => {
      const [first] = eventRecords;
      if (first && ACTIVATION_KEYS.has(event.key)) onSelect?.(String(first.id));
    },
  };
}
