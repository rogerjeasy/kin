"use client";

import type { Scheduler, SchedulerConfig } from "@bryntum/scheduler";
import { useEffect, useRef } from "react";

import type { BryntumModule } from "./bryntum-runtime.ts";
import { applyLive, liveConfig, type LiveConfig } from "./care-calendar-live.ts";

type Props = { readonly bryntum: BryntumModule; readonly build: SchedulerConfig; readonly live: LiveConfig };

/**
 * Bryntum's Scheduler in a box of its own. The widget is built when `build`
 * changes and updated in place when `live` does, so a new week or a refreshed
 * list of shifts does not rebuild it. It is destroyed when the box goes away.
 */
export function CareCalendarWidget({ bryntum, build, live }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scheduler = useRef<Scheduler | null>(null);
  // The live config the widget was last brought up to.
  const applied = useRef(live);
  const latest = useRef(live);

  // Effects run in this order: note the latest live config, build, then update.
  useEffect(() => {
    latest.current = live;
  }, [live]);

  useEffect(() => {
    const appendTo = host.current;
    if (!appendTo) return;
    const built = new bryntum.Scheduler({ ...build, ...liveConfig(latest.current, build.features), appendTo });
    scheduler.current = built;
    applied.current = latest.current;
    return () => {
      built.destroy();
      scheduler.current = null;
    };
  }, [bryntum, build]);

  useEffect(() => {
    const built = scheduler.current;
    if (!built || applied.current === live) return;
    applyLive(built, applied.current, live);
    applied.current = live;
  }, [live]);

  return <div ref={host} />;
}
