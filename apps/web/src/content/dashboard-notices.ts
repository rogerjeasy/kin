import type { DemoPayee } from "./circle/payout-proof";

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
  "stepUpMissing",
  "stepUpStale",
  "paused",
  "resumed",
  "invited",
  "invalidInvite",
  "invitedDemo",
  "inviteLimit",
  "alreadyInvited",
  "alreadyMember",
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

/**
 * The notices as one circle says them. A demo circle pays with simulated
 * money, or a caregiver through PayPal's sandbox, so its "approved" never
 * says PayPal will confirm a real payment (AGENTS.md section 5, rule 9).
 */
export function circleNotices(notices: Readonly<Record<Notice, string>> & { readonly approvedSimulated: string; readonly approvedSandbox: string }, demoPayee: DemoPayee): Readonly<Record<Notice, string>> {
  if (demoPayee === null) return notices;
  return { ...notices, approved: demoPayee === "sandbox" ? notices.approvedSandbox : notices.approvedSimulated };
}
