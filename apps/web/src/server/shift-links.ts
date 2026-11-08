import { asPerson, hashCheckToken, mintCheckLink, newCheckToken, type CircleSnapshot, type Database, type ShiftRecord } from "@kin/db";
import { CheckInTextError, TextDeliveryError, checkInText, isE164, type TextSender } from "@kin/notify";

import { isLocale, type Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";

import { createRateLimiter, type RateLimiter } from "./model";
import { qrCode, type QrCode } from "./qr-code";
import { onlyKeys, uuidField } from "./shift-input";

/** Why a link could not be made, beyond the reasons every shift operation has. */
export type LinkFailure = "bad_phone" | "texting_off" | "text_limit";

/** What a made link says about the text, if one was asked for. The number is never part of it. */
export type TextOutcome = "none" | "sent" | "failed";

/**
 * A check-in link, shown once: the address (which holds the secret), the same
 * address as a QR code, and when it stops working. Only the hash of the secret
 * is stored, so this is the only time it can be shown.
 */
export type MadeLink = { readonly url: string; readonly qr: QrCode; readonly expiresAt: string; readonly text: TextOutcome };

/** What making and texting a link needs beyond the database: where the app lives, a text sender if there is one, and the limit on texts. */
export type LinkServices = {
  /** The app's public origin, no trailing slash. */
  readonly origin: string;
  readonly texts: TextSender | null;
  readonly textLimiter: RateLimiter;
  readonly now: () => number;
};

const HOUR_MS = 3_600_000;
/** The database lets a link live until six hours after the shift was planned to end, and no longer. */
const GRACE_MS = 6 * HOUR_MS;
const MAX_PHONE_CHARS = 16;
/** Each person may text eight links an hour; a text costs money and goes to a number a person typed. */
const TEXTS_PER_HOUR = 8;
const LINKABLE_STATES: readonly ShiftRecord["state"][] = ["scheduled", "checked_in"];

export const textLimiter = createRateLimiter(TEXTS_PER_HOUR, HOUR_MS);

type Failure = { readonly ok: false; readonly reason: "invalid" | "refused" | "wrong_state" | LinkFailure };
type Made = { readonly ok: true; readonly link: MadeLink };

const refusal = (reason: Failure["reason"]): Failure => ({ ok: false, reason });
const firstNameOf = (displayName: string): string => displayName.trim().split(/\s+/u)[0] ?? displayName;

export type LinkRequest = { readonly shiftId: string; readonly locale: Locale; readonly phone: string | null };

/** A link request as the panel sends it: a shift, the language of the text, and optionally the number to text. */
export function linkRequest(row: Record<string, unknown>): LinkRequest | Failure {
  if (!onlyKeys(row, ["operation", "shiftId", "locale", "phone"])) return refusal("invalid");
  const shiftId = uuidField(row["shiftId"]);
  const locale = typeof row["locale"] === "string" && isLocale(row["locale"]) ? row["locale"] : null;
  if (shiftId === null || locale === null) return refusal("invalid");
  const phone = row["phone"];
  if (phone === undefined) return { shiftId, locale, phone: null };
  if (typeof phone !== "string") return refusal("invalid");
  // The panel sends what was typed; a number is a plus and digits, so spaces and dashes are the person's own.
  const digits = phone.replace(/[\s().-]/g, "");
  return digits.length <= MAX_PHONE_CHARS && isE164(digits) ? { shiftId, locale, phone: digits } : refusal("bad_phone");
}

/**
 * Makes a no-login check-in link for one shift, and texts it when a number was
 * given. The caller has already been allowed `shift.link`; the database checks
 * the shift's own member and the family roles again, and caps the live links.
 * Nothing about the number is stored, logged or returned, and a link that could
 * not be texted is still returned, so the screen can offer to copy it.
 */
export async function makeCheckLink(
  who: { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot },
  request: LinkRequest,
  services: LinkServices,
): Promise<Made | Failure> {
  const { circle } = who;
  const shift = circle.shifts.find((each) => each.id === request.shiftId);
  // A shift the viewer cannot read is not theirs to link: the database hides it, so this one says the same.
  if (shift === undefined) return refusal("refused");
  const expiresAt = new Date(shift.endsAt.getTime() + GRACE_MS);
  if (!LINKABLE_STATES.includes(shift.state) || expiresAt.getTime() <= circle.circle.now.getTime()) return refusal("wrong_state");
  if (request.phone !== null) {
    if (services.texts === null) return refusal("texting_off");
    if (!services.textLimiter.allows(who.userId, services.now())) return refusal("text_limit");
  }
  const token = newCheckToken();
  await asPerson(who.db, who.userId, (tx) => mintCheckLink(tx, { circleId: circle.circle.id, shiftId: shift.id, tokenHash: hashCheckToken(token), expiresAt }));
  const url = `${services.origin}${localizedPath(request.locale, `/c/${token}`)}`;
  const text = request.phone === null ? "none" : await sendText(services, who.userId, circle, shift, request, url);
  return { ok: true, link: { url, qr: qrCode(url), expiresAt: expiresAt.toISOString(), text } };
}

async function sendText(services: LinkServices, userId: string, circle: CircleSnapshot, shift: ShiftRecord, request: LinkRequest, url: string): Promise<TextOutcome> {
  const { texts } = services;
  if (texts === null || request.phone === null) return "failed";
  services.textLimiter.record(userId, services.now());
  const caregiver = circle.members.find((member) => member.id === shift.memberId);
  try {
    const body = checkInText({ locale: request.locale, caregiverName: firstNameOf(caregiver?.displayName ?? ""), startsAt: shift.startsAt, timezone: circle.circle.timezone, link: url });
    await texts.send({ to: request.phone, body });
    return "sent";
  } catch (error) {
    // Only the kind of failure is logged: never the number, the text or the link.
    if (error instanceof TextDeliveryError || error instanceof CheckInTextError) {
      console.error(JSON.stringify({ message: "shift.link.text_failed", error: error.name, reason: error instanceof TextDeliveryError ? error.reason : "message" }));
      return "failed";
    }
    throw error;
  }
}
