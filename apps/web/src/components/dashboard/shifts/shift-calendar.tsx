"use client";

import { useSyncExternalStore } from "react";

import { CareCalendar, type CareCalendarProps } from "@/components/dashboard/shifts/care-calendar";

const WIDE = "(min-width: 768px)";

const subscribe = (notify: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

/** Whether the screen is tablet width or more. The server and the first paint say no, so a phone never loads the calendar. */
function useWideScreen(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => false);
}

/**
 * The week's calendar, from tablet width up. A phone has the list of cards
 * instead, which is always on the page, so the calendar is not even loaded
 * there. Choosing a shift on the calendar takes keyboard focus to its card,
 * which is where its words and actions live.
 */
export function ShiftCalendar(props: Omit<CareCalendarProps, "onSelect">) {
  const wide = useWideScreen();
  if (!wide) return null;
  const select = (shiftId: string) => {
    const card = document.getElementById(`shift-${shiftId}`);
    card?.scrollIntoView({ block: "center" });
    card?.focus();
  };
  return (
    <div className="min-w-0 overflow-x-auto rounded-2xl border bg-card p-2">
      <CareCalendar {...props} onSelect={select} />
    </div>
  );
}
