import type { SchedulerConfig } from "@bryntum/scheduler";
import { useEffect, useMemo, useRef } from "react";

import { READ_ONLY_STORES, assistantFeature } from "./care-calendar-assistant.ts";
import type { LiveConfig } from "./care-calendar-live.ts";
import { calendarHeight, nameColumn, staticOptions } from "./care-calendar-options.ts";
import { stackDepths, toSchedulerEvent, visibleHours, weekRange } from "./care-calendar-model.ts";
import { eventRenderer, eventTooltip } from "./care-calendar-render.ts";
import { NOW_ID, scrollToWhatMatters } from "./care-calendar-scroll.ts";
import type { CareCalendarProps } from "./care-calendar-types.ts";
import type { BryntumModule } from "./bryntum-runtime.ts";

const ACTIVATION_KEYS: ReadonlySet<string> = new Set(["Enter", " "]);

/**
 * What the widget is built with: this changes only when the widget has to be
 * built again (the direction, the assistant, the library). It is memoised, so
 * a new object means a rebuild.
 */
export function useBuildConfig(bryntum: BryntumModule, props: CareCalendarProps): SchedulerConfig {
  const { dir, locale, assistant, onSelect } = props;
  // The widget's listeners outlive a render; they call whatever the page last passed.
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);
  const withAssistant = Boolean(assistant);

  return useMemo<SchedulerConfig>(() => {
    // Bryntum 7.3.8 overflows the stack while building the assistant in a right-to-left locale, which would
    // leave Arabic and Hebrew readers with the plain-text list instead of the calendar. The assistant waits for a fix.
    const ai = withAssistant && dir === "ltr" ? assistantFeature(bryntum, locale) : undefined;
    return {
      ...staticOptions,
      features: { ...staticOptions.features, ...(ai ? { ai } : {}) },
      ...(ai ? READ_ONLY_STORES : {}),
      rtl: dir === "rtl",
      listeners: {
        paint: ({ source, firstPaint }) => {
          if (firstPaint && source instanceof bryntum.Scheduler) scrollToWhatMatters(bryntum, source);
        },
        eventClick: ({ eventRecord }) => select.current?.(String(eventRecord.id)),
        eventKeyDown: ({ eventRecords, event }) => {
          const [first] = eventRecords;
          if (first && ACTIVATION_KEYS.has(event.key)) select.current?.(String(first.id));
        },
      },
    };
  }, [bryntum, dir, locale, withAssistant]);
}

/** The settings that follow the data, for what the calendar was given. Every value is memoised: the widget is updated with only the ones that changed. */
export function useLiveConfig(props: CareCalendarProps): LiveConfig {
  const { resources, events, weekStart, timezone, locale, now, label } = props;
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

  return useMemo(
    () => ({ ariaLabel: label, timeZone: timezone, workingTime, range, height, columns, resources: rows, events: records, timeRanges: nowLine, eventRenderer: renderer, tooltip }),
    [label, timezone, workingTime, range, height, columns, rows, records, nowLine, renderer, tooltip],
  );
}
