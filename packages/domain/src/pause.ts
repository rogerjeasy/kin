/** How long the pause switch holds every outgoing payment. */
export const PAUSE_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/** When a pause pressed at `now` lifts. */
export function pauseEndsAt(now: Date): Date {
  return new Date(now.getTime() + PAUSE_HOURS * HOUR_MS);
}

/** True while a pause that lifts at `pausedUntil` still holds at `now`. */
export function isPaused(pausedUntil: Date | null, now: Date): boolean {
  return pausedUntil !== null && now.getTime() < pausedUntil.getTime();
}
