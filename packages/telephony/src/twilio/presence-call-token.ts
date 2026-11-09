import { isOfficeLocale, type OfficeLocale } from "../office-words.ts";
import { CALL_SID } from "./call-state.ts";
import { openToken, sealToken } from "./sealed-token.ts";

/**
 * Where the parent's call to Kin's "is it really you?" line stands between two
 * webhook turns, sealed into the address Kin gave Twilio for the next turn. It
 * names the call, the circle and, once Kin has opened one, the check, as
 * identifiers only: the names and the verdict are read from the record each turn.
 * It cannot be forged (HMAC under Kin's own key) and it dies after twenty minutes.
 */
export type PresenceCallToken = {
  /** Twilio's ID of the call: a token from one call cannot steer another. */
  readonly sid: string;
  /** The one circle the dialled number belongs to. */
  readonly circleId: string;
  readonly locale: OfficeLocale;
  /** The check Kin opened for this call, once it has. */
  readonly checkId: string | null;
  /** How many times Kin could not understand the parent (0 or 1) before a check was opened. */
  readonly reasked: number;
  /** How many times Kin has looked at the check's answer and found none yet. */
  readonly waits: number;
};

export const PRESENCE_CALL_TOKEN_TTL_MS = 20 * 60 * 1000;
export const PRESENCE_CALL_ROUTES = { incoming: "/voice/presence/incoming", turn: "/voice/presence/turn", wait: "/voice/presence/wait", code: "/voice/presence/code" } as const;
/** Kin asks once more when it hears nothing, and then ends the call. */
export const MAX_PRESENCE_REASKS = 1;
/** Five seconds a look, so this is about two minutes: past the ninety-second window plus the sweep. */
export const MAX_PRESENCE_WAITS = 24;
export const PRESENCE_WAIT_SECONDS = 5;
const KIND = "presence_call";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sealPresenceCallToken(token: PresenceCallToken, key: string, now: number): string {
  return sealToken({ kind: KIND, ...token, exp: now + PRESENCE_CALL_TOKEN_TTL_MS }, key);
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The token's contents, or `null` when it is forged, expired, another kind of token or malformed. */
export function openPresenceCallToken(text: string, key: string, now: number): PresenceCallToken | null {
  const payload = openToken(text, key);
  if (!isObject(payload) || payload["kind"] !== KIND) return null;
  const { sid, circleId, locale, checkId, reasked, waits, exp } = payload;
  if (typeof exp !== "number" || exp <= now) return null;
  if (typeof sid !== "string" || !CALL_SID.test(sid) || typeof circleId !== "string" || !UUID.test(circleId)) return null;
  if (typeof locale !== "string" || !isOfficeLocale(locale)) return null;
  if (checkId !== null && (typeof checkId !== "string" || !UUID.test(checkId))) return null;
  if (typeof reasked !== "number" || !Number.isInteger(reasked) || reasked < 0 || reasked > MAX_PRESENCE_REASKS) return null;
  if (typeof waits !== "number" || !Number.isInteger(waits) || waits < 0 || waits > MAX_PRESENCE_WAITS) return null;
  return { sid, circleId, locale, checkId, reasked, waits };
}

/** The address Twilio posts the parent's words, or fetches the next look, from: a route and its sealed token. `publicUrl` has no trailing slash, as `KIN_VOICE_PUBLIC_URL` has none. */
export function presenceCallUrl(publicUrl: string, route: "turn" | "wait" | "code", token: string): string {
  return `${publicUrl.replace(/\/+$/, "")}${PRESENCE_CALL_ROUTES[route]}?s=${encodeURIComponent(token)}`;
}
