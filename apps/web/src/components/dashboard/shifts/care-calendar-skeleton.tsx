const ROWS = 3;

/**
 * What shows while the calendar loads: rows where the people will be. It has
 * no words to read out, so a screen reader skips it.
 */
export function CareCalendarSkeleton() {
  return (
    <div aria-hidden="true" className="min-w-0 space-y-2 rounded-lg border p-3">
      {Array.from({ length: ROWS }, (_, row) => (
        <div key={row} className="h-14 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      ))}
    </div>
  );
}
