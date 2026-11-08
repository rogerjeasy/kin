"use client";

// Exactly one structural sheet, one theme and the icon font. The theme is the
// light one; care-calendar.css sets its variables from Kin's tokens, which is
// what makes the calendar follow the light and dark themes. Styles are small
// and bundled; the library's script is not (bryntum-runtime.ts).
import "@bryntum/scheduler/scheduler.css";
import "@bryntum/scheduler/stockholm-light.css";
import "@bryntum/scheduler/fontawesome/css/fontawesome.css";
import "@bryntum/scheduler/fontawesome/css/solid.css";
import "./care-calendar.css";

import { useEffect, useState } from "react";

import { loadBryntum, type BryntumModule } from "./bryntum-runtime.ts";
import { applyLocale } from "./care-calendar-locale.ts";
import { CareCalendarSkeleton } from "./care-calendar-skeleton.tsx";
import type { CareCalendarProps } from "./care-calendar-types.ts";
import { CareCalendarView } from "./care-calendar-view.tsx";

/** The library, with the viewer's language applied; null while it loads. A failure is handed to the error boundary. */
function useBryntum(locale: string): BryntumModule | null {
  const [ready, setReady] = useState<BryntumModule | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    let current = true;
    setReady(null);
    loadBryntum()
      .then(async (bryntum) => {
        await applyLocale(bryntum, locale);
        return bryntum;
      })
      .then(
        (bryntum) => current && setReady(bryntum),
        (error: unknown) => current && setLoadError(error),
      );
    return () => {
      current = false;
    };
  }, [locale]);

  if (loadError) throw loadError;
  return ready;
}

/** The calendar itself. It runs only in the browser, loaded by CareCalendar. */
export default function CareCalendarScheduler(props: CareCalendarProps) {
  const bryntum = useBryntum(props.locale);
  return bryntum ? <CareCalendarView bryntum={bryntum} {...props} /> : <CareCalendarSkeleton />;
}
