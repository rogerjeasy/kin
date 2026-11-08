import { asPerson, setParentCallSettings, type CircleSnapshot, type Database } from "@kin/db";
import { isE164 } from "@kin/notify";

import { onlyKeys } from "./shift-input";

export type CallSettingsFailure = "invalid" | "refused" | "bad_phone" | "consent_needed";

/** What the parent's phone call settings form sends: off, or on with a number and the parent's agreement. */
export type CallSettingsRequest =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly phone: string; readonly consent: true };

const MAX_PHONE_CHARS = 16;

/** Reads the form's request. A number is a plus and digits; the spaces and dashes a person types are theirs. */
export function callSettingsRequest(row: Record<string, unknown>): CallSettingsRequest | { readonly ok: false; readonly reason: CallSettingsFailure } {
  if (!onlyKeys(row, ["operation", "enabled", "phone", "consent"])) return { ok: false, reason: "invalid" };
  if (row["enabled"] === false) return row["phone"] === undefined && row["consent"] === undefined ? { enabled: false } : { ok: false, reason: "invalid" };
  if (row["enabled"] !== true) return { ok: false, reason: "invalid" };
  if (row["consent"] !== true) return { ok: false, reason: "consent_needed" };
  if (typeof row["phone"] !== "string") return { ok: false, reason: "bad_phone" };
  const digits = row["phone"].replace(/[\s().-]/g, "");
  return digits.length <= MAX_PHONE_CHARS && isE164(digits) ? { enabled: true, phone: digits, consent: true } : { ok: false, reason: "bad_phone" };
}

/**
 * Whether the viewer's seat may switch the call on in this circle: the parent
 * in their own name, and in a demo circle the organizer playing her. The
 * database holds the same rule, and a real circle's organizer is refused there.
 */
export function mayEnableCall(circle: CircleSnapshot): boolean {
  const { role } = circle.viewer;
  return role === "parent" || (role === "organizer" && circle.circle.demo);
}

/** Records the switch. The number goes to the database and nowhere else: not to a log, not back to the screen. */
export async function setCallSettings(who: { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot }, request: CallSettingsRequest): Promise<void> {
  const input = request.enabled ? { phone: request.phone, enabled: true, consent: true } : { phone: null, enabled: false, consent: false };
  await asPerson(who.db, who.userId, (tx) => setParentCallSettings(tx, { circleId: who.circle.circle.id, ...input }));
}
