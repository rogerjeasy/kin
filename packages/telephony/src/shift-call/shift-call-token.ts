import { isOfficeLocale, type OfficeLocale } from "../office-words.ts";
import { openToken, sealToken } from "../twilio/sealed-token.ts";

/**
 * What the answer webhook needs to know about an outbound call, sealed into
 * the address Kin gave Twilio. Twilio reads the token (it is in a URL), so it
 * holds identifiers only: never a name, a number or an amount. The webhook
 * loads those from the record by `shiftId`.
 *
 * The token cannot be forged (HMAC under Kin's own key, not Twilio's token) and
 * dies after `SHIFT_CALL_TOKEN_TTL_MS`, so an old address cannot be replayed
 * into a new call. It cannot name the call itself, because the token is made
 * before Twilio assigns a sid; the webhook binds the two by checking the
 * `CallSid` it receives against the one stored on the attempt (`attempt`), and
 * refuses a webhook for an attempt that is no longer current.
 */
export type ShiftCallToken = {
  readonly circleId: string;
  readonly shiftId: string;
  /** Which attempt of the shift's call this is, from 1. */
  readonly attempt: number;
  readonly locale: OfficeLocale;
  /** How many times the parent has been asked again after silence or an unclear answer: 0 or 1. */
  readonly reasked: number;
};

/** A call rings and talks for a few minutes. A token older than this belongs to a call that should have ended. */
export const SHIFT_CALL_TOKEN_TTL_MS = 20 * 60 * 1000;
/** Kin asks once more, and then leaves it to the family. */
export const MAX_SHIFT_REASKS = 1;
const MAX_ATTEMPT = 10;
/** Kind tag, so another service's token sealed under the same key is never read as this one. */
const KIND = "shift_call";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sealShiftCallToken(token: ShiftCallToken, key: string, now: number): string {
  return sealToken({ kind: KIND, ...token, exp: now + SHIFT_CALL_TOKEN_TTL_MS }, key);
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The token's contents, or `null` when it is forged, expired, another kind of token or malformed. */
export function openShiftCallToken(text: string, key: string, now: number): ShiftCallToken | null {
  const payload = openToken(text, key);
  if (!isObject(payload) || payload.kind !== KIND) return null;
  const { circleId, shiftId, attempt, locale, reasked, exp } = payload;
  if (typeof exp !== "number" || exp <= now) return null;
  if (typeof circleId !== "string" || !UUID.test(circleId) || typeof shiftId !== "string" || !UUID.test(shiftId)) return null;
  if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPT) return null;
  if (typeof locale !== "string" || !isOfficeLocale(locale)) return null;
  if (typeof reasked !== "number" || !Number.isInteger(reasked) || reasked < 0 || reasked > MAX_SHIFT_REASKS) return null;
  return { circleId, shiftId, attempt, locale, reasked };
}

/** The routes of the phone service that Twilio calls for a shift call. One list, so the worker that places the call and the service that answers agree. */
export const SHIFT_CALL_ROUTES = { answer: "/voice/shift/answer", status: "/voice/shift/status" } as const;

/**
 * The address of one of the routes, carrying the sealed token. `publicUrl` is
 * the service's public base with no trailing slash, as `KIN_VOICE_PUBLIC_URL`
 * is: Twilio signs exactly the URL it called, so the service must rebuild it
 * the same way.
 */
export function shiftCallUrl(publicUrl: string, route: keyof typeof SHIFT_CALL_ROUTES, token: string): string {
  return `${publicUrl.replace(/\/+$/, "")}${SHIFT_CALL_ROUTES[route]}?s=${encodeURIComponent(token)}`;
}
