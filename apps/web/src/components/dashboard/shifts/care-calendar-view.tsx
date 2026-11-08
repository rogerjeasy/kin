"use client";

import { CareCalendarAssistantNote } from "./care-calendar-assistant-note.tsx";
import type { BryntumModule } from "./bryntum-runtime.ts";
import { CareCalendarWidget } from "./care-calendar-widget.tsx";
import type { CareCalendarProps } from "./care-calendar-types.ts";
import { useBuildConfig, useLiveConfig } from "./use-scheduler-props.ts";

/** The calendar once the library and the language are in. */
export function CareCalendarView({ bryntum, ...props }: CareCalendarProps & { readonly bryntum: BryntumModule }) {
  const build = useBuildConfig(bryntum, props);
  const live = useLiveConfig(props);

  return (
    <div className="care-calendar min-w-0 max-w-full" dir={props.dir}>
      {props.assistant && props.dir === "ltr" ? <CareCalendarAssistantNote copy={props.assistant} /> : null}
      <CareCalendarWidget bryntum={bryntum} build={build} live={live} />
    </div>
  );
}
