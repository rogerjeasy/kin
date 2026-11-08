import type { SchedulerConfig } from "@bryntum/scheduler";

import { TICK_HOURS } from "./care-calendar-model.ts";

/** The most the calendar grows before it scrolls inside itself. */
const MAX_HEIGHT_PX = 560;
const ROW_HEIGHT_PX = 64;
const BAR_MARGIN_PX = 6;
/** The two header rows. */
const HEADER_HEIGHT_PX = 64;
/** The horizontal scrollbar floats over the last row, so it gets room of its own. */
const SCROLLBAR_HEIGHT_PX = 16;
const NAME_COLUMN_WIDTH_PX = 132;

type Features = NonNullable<SchedulerConfig["features"]>;

/** The calendar is a view: the family changes a shift through Kin's own forms, never here. */
const NO_EDITING = {
  eventDrag: false,
  eventDragCreate: false,
  eventDragSelect: false,
  eventResize: false,
  eventEdit: false,
  simpleEventEdit: false,
  eventMenu: false,
  scheduleMenu: false,
  cellMenu: false,
  headerMenu: false,
  timeAxisHeaderMenu: false,
  cellEdit: false,
  columnResize: false,
  columnReorder: false,
  columnPicker: false,
  columnRename: false,
  resourceColumnReorder: false,
  rowReorder: false,
  rowResize: false,
  sort: false,
  filter: false,
  filterBar: false,
  group: false,
  ai: false,
  aiFilter: false,
  eventCopyPaste: false,
  cellCopyPaste: false,
  pan: false,
  quickFind: false,
  search: false,
} satisfies Features;

/** A week, one column group per day, a tick every few hours: a shift of a few hours reads at a glance. */
const CARE_WEEK_PRESET = {
  base: "hourAndDay",
  id: "careWeek",
  tickWidth: 80,
  headers: [
    { unit: "day", dateFormat: "ddd D MMM" },
    { unit: "hour", increment: TICK_HOURS, dateFormat: "HH" },
  ],
} satisfies NonNullable<SchedulerConfig["viewPreset"]>;

/** What the widget is built with, whatever the data: read-only, with no editing, no motion and one week preset. */
export const staticOptions = {
  readOnly: true,
  features: {
    ...NO_EDITING,
    // Stripes, column lines and the "now" line help the eye along a long week.
    columnLines: true,
    stripe: true,
    timeRanges: true,
  } satisfies Features,
  // No motion at all: nothing slides or fades, so reduced-motion is always honoured.
  useInitialAnimation: false,
  transition: { removeRecord: false, changeEvent: false },
  autoAdjustTimeAxis: false,
  viewPreset: CARE_WEEK_PRESET,
  allowOverlap: true,
  eventLayout: "stack" as const,
  eventStyle: "filled" as const,
  rowHeight: ROW_HEIGHT_PX,
  barMargin: BAR_MARGIN_PX,
  zoomOnMouseWheel: false,
  zoomOnTimeAxisDoubleClick: false,
} satisfies SchedulerConfig;

/**
 * The height that shows every person's row in full, up to the cap. A row grows
 * by one bar and its margin for each shift stacked on another (depths come
 * from stackDepths), and the rows scroll inside the calendar past the cap.
 */
export function calendarHeight(depths: readonly number[]): number {
  const rows = depths.reduce((sum, depth) => sum + ROW_HEIGHT_PX + (Math.max(depth, 1) - 1) * (ROW_HEIGHT_PX - BAR_MARGIN_PX), 0);
  return Math.min(MAX_HEIGHT_PX, HEADER_HEIGHT_PX + rows + SCROLLBAR_HEIGHT_PX);
}

/** The one column, the person's name. Its header has no words of Kin's own, so a screen reader hears the calendar's name. */
export function nameColumn(label: string): SchedulerConfig["columns"] {
  return [{ field: "name", ariaLabel: label, width: NAME_COLUMN_WIDTH_PX, minWidth: NAME_COLUMN_WIDTH_PX, htmlEncode: true, cellCls: "care-person", enableHeaderContextMenu: false }];
}
