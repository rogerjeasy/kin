/**
 * What the circle's screens can say after an action, carried back in the
 * `notice` query parameter. Each key has words in every dictionary.
 */
export const NOTICES = [
  "answered",
  "approved",
  "rejected",
  "closed",
  "refused",
  "freshCheck",
  "paused",
  "resumed",
  "invited",
  "invalidInvite",
  "roleChanged",
  "restarted",
  "circleCreated",
  "invalidCircle",
] as const;

export type Notice = (typeof NOTICES)[number];

export function isNotice(value: string | null): value is Notice {
  return value !== null && (NOTICES as readonly string[]).includes(value);
}

/** A circle screen's path with a notice to show on arrival. */
export function withNotice(path: string, notice: Notice): string {
  return `${path}?${new URLSearchParams({ notice }).toString()}`;
}
