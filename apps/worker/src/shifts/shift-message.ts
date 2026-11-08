/** What every shift loop shares about an outbox message: its payload is `{ shiftId }`, and a failing one is looked at less and less often. */

/** A message that keeps failing is looked at less and less often, up to once an hour. */
const MAX_BACKOFF_SECONDS = 3_600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The delay before a message that has been handed out `attempts` times is handed out again: 30 seconds, doubling, to an hour. */
export function backoffSeconds(attempts: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** Math.min(attempts, 7));
}

/** The shift a message is about, or `null` when the payload is not `{ shiftId: <uuid> }`. */
export function shiftIdOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as Record<string, unknown>)["shiftId"];
  return typeof id === "string" && UUID.test(id) ? id : null;
}

/** What a log line may say of an error: its name, never its message, which can quote a query's values or a provider's words (AGENTS.md section 6). */
export const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");
