"use client";

// Exactly one structural sheet, one theme and the icon font. The theme is the
// light one; care-calendar.css sets its variables from Kin's tokens, which is
// what makes the calendar follow the light and dark themes.
import "@bryntum/scheduler/scheduler.css";
import "@bryntum/scheduler/stockholm-light.css";
import "@bryntum/scheduler/fontawesome/css/fontawesome.css";
import "@bryntum/scheduler/fontawesome/css/solid.css";
import "./care-calendar.css";

import { BryntumScheduler } from "@bryntum/scheduler-react";
import { useEffect, useState } from "react";

import { CareCalendarAssistantNote } from "./care-calendar-assistant-note.tsx";
import { applyLocale } from "./care-calendar-locale.ts";
import { CareCalendarSkeleton } from "./care-calendar-skeleton.tsx";
import type { CareCalendarProps } from "./care-calendar-types.ts";
import { useSchedulerProps } from "./use-scheduler-props.ts";

/** The calendar itself. It runs only in the browser, loaded by CareCalendar. */
export default function CareCalendarScheduler(props: CareCalendarProps) {
  const [localeReady, setLocaleReady] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const schedulerProps = useSchedulerProps(props);

  useEffect(() => {
    setLocaleReady(false);
    applyLocale(props.locale).then(() => setLocaleReady(true), setLoadError);
  }, [props.locale]);

  // Handed to the error boundary, which shows the calendar as plain text.
  if (loadError) throw loadError;
  if (!localeReady) return <CareCalendarSkeleton />;

  return (
    <div className="care-calendar min-w-0 max-w-full" dir={props.dir}>
      {props.assistant && props.dir === "ltr" ? <CareCalendarAssistantNote copy={props.assistant} /> : null}
      <BryntumScheduler {...schedulerProps} />
    </div>
  );
}
