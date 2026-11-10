import type { CareCalendarProps } from "./care-calendar-types.ts";

type Props = Pick<CareCalendarProps, "events" | "resources" | "label" | "locale" | "timezone">;

/**
 * The calendar as plain text: the same shifts, in time order, with no widget.
 * It stands in when the calendar cannot load, and it needs no words of its own.
 */
export function CareCalendarFallback({ events, resources, label, locale, timezone }: Props) {
  const format = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const names = new Map(resources.map((person) => [person.id, person.name]));
  const ordered = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <ul aria-label={label} className="divide-y rounded-2xl border bg-card">
      {ordered.map((event) => (
        <li key={event.id} className="min-w-0 px-4 py-3 text-sm">
          <p className="truncate font-medium">{event.title}</p>
          <p className="text-muted-foreground">
            {names.get(event.resourceId)} · {format.format(new Date(event.startsAt))} · {event.statusText}
          </p>
        </li>
      ))}
    </ul>
  );
}
