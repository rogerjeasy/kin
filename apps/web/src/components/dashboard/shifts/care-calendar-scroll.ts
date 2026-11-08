import type { Scheduler } from "@bryntum/scheduler";

import type { BryntumModule } from "./bryntum-runtime.ts";

export const NOW_ID = "now";

const asDate = (value: unknown): Date | undefined => (value instanceof Date ? value : undefined);

/** Opens the week at the "now" line when it is in the week, otherwise at the first shift. */
export function scrollToWhatMatters({ EventModel, Store, TimeRangeModel }: BryntumModule, scheduler: Scheduler): void {
  // The data loads after the widget is painted.
  scheduler.whenProjectReady(() => {
    const store = scheduler.timeRangeStore;
    const now = store instanceof Store ? store.getById(NOW_ID) : undefined;
    const nowAt = now instanceof TimeRangeModel ? asDate(now.startDate) : undefined;
    const starts = scheduler.eventStore.records.flatMap((event) => {
      const start = event instanceof EventModel ? asDate(event.startDate) : undefined;
      return start ? [start] : [];
    });
    const first = starts.sort((a, b) => a.getTime() - b.getTime())[0];
    // The scheduler's own dates are on the circle's clock, like the shifts and the line.
    const inWeek = nowAt !== undefined && nowAt >= scheduler.startDate && nowAt < scheduler.endDate;
    const target = inWeek ? nowAt : first;
    if (target) void scheduler.scrollToDate(target, { block: "start", edgeOffset: 48, animate: false });
  });
}
