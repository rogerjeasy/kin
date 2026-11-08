"use client";

import dynamic from "next/dynamic";

import { CareCalendarBoundary } from "./care-calendar-boundary.tsx";
import { CareCalendarFallback } from "./care-calendar-fallback.tsx";
import { CareCalendarSkeleton } from "./care-calendar-skeleton.tsx";
import type { CareCalendarProps } from "./care-calendar-types.ts";

export type { CalendarEvent, CalendarResource, CareCalendarProps } from "./care-calendar-types.ts";

// Bryntum is large and works only in a browser. It loads here, after the page
// is shown, and no other page carries it.
const Scheduler = dynamic(() => import("./care-calendar-scheduler.tsx"), {
  ssr: false,
  loading: () => <CareCalendarSkeleton />,
});

export function CareCalendar(props: CareCalendarProps) {
  return (
    <CareCalendarBoundary fallback={<CareCalendarFallback {...props} />}>
      <Scheduler {...props} />
    </CareCalendarBoundary>
  );
}
