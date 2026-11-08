import type { EventTooltipConfig, Scheduler, SchedulerConfig } from "@bryntum/scheduler";

import type { WeekRange } from "./care-calendar-model.ts";

type WorkingTime = NonNullable<SchedulerConfig["workingTime"]>;

/**
 * What changes while the calendar stays on the page: a new week, new shifts,
 * a new clock. Each value is memoised by its maker, so a value that is the
 * same object as before is a value that did not change.
 */
export type LiveConfig = {
  readonly ariaLabel: string;
  readonly timeZone: string;
  /** Undefined shows the whole day. */
  readonly workingTime: WorkingTime | undefined;
  readonly range: WeekRange;
  readonly height: number;
  readonly columns: SchedulerConfig["columns"];
  readonly resources: SchedulerConfig["resources"];
  readonly events: SchedulerConfig["events"];
  readonly timeRanges: SchedulerConfig["timeRanges"];
  readonly eventRenderer: SchedulerConfig["eventRenderer"];
  readonly tooltip: EventTooltipConfig;
};

const WHOLE_DAY: WorkingTime = { fromHour: 0, toHour: 24 };

/** The part of the construction config that follows the data. */
export function liveConfig(live: LiveConfig, features: SchedulerConfig["features"]): SchedulerConfig {
  return {
    ariaLabel: live.ariaLabel,
    timeZone: live.timeZone,
    startDate: live.range.start,
    endDate: live.range.end,
    height: live.height,
    columns: live.columns,
    resources: live.resources,
    events: live.events,
    timeRanges: live.timeRanges,
    eventRenderer: live.eventRenderer,
    features: { ...features, eventTooltip: live.tooltip },
    ...(live.workingTime ? { workingTime: live.workingTime } : {}),
  };
}

/**
 * Brings a built widget from one live config to the next by assigning only
 * what changed, as Bryntum's own wrappers do: the widget is not rebuilt, so
 * the scroll position, the focus and an open assistant stay where they are.
 */
export function applyLive(scheduler: Scheduler, previous: LiveConfig, next: LiveConfig): void {
  // Assigned through plain objects, because the widget's setters take configs that its config types do not name.
  const settings: Record<string, unknown> = {};
  if (previous.timeZone !== next.timeZone) settings.timeZone = next.timeZone;
  if (previous.workingTime !== next.workingTime) settings.workingTime = next.workingTime ?? WHOLE_DAY;
  if (previous.ariaLabel !== next.ariaLabel) settings.ariaLabel = next.ariaLabel;
  if (previous.height !== next.height) settings.height = next.height;
  if (previous.columns !== next.columns) settings.columns = next.columns;
  if (previous.eventRenderer !== next.eventRenderer) settings.eventRenderer = next.eventRenderer;
  Object.assign(scheduler, settings);

  if (previous.range !== next.range) scheduler.setTimeSpan(next.range.start, next.range.end);
  if (previous.tooltip !== next.tooltip) scheduler.features.eventTooltip.setConfig(next.tooltip);

  // Data last, so the rows are drawn once against the final time span.
  const data: Record<string, unknown> = {};
  if (previous.resources !== next.resources) data.resources = next.resources;
  if (previous.events !== next.events) data.events = next.events;
  if (previous.timeRanges !== next.timeRanges) data.timeRanges = next.timeRanges;
  Object.assign(scheduler, data);
}
