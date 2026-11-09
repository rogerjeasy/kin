import { isOfficeLocale, type OfficeLocale } from "../office-words.ts";
import { openToken, sealToken } from "./sealed-token.ts";

/**
 * What the webhooks of Kin's call to the real person need to know, sealed into the address Kin gave Twilio. Identifiers
 * only: the names, the amount and the state are read from the record each turn. It cannot be forged (HMAC under Kin's own
 * key) and it dies after twenty minutes. The webhook binds it to the call by the CallSid Twilio sends, which the database
 * checks against the one it recorded for this check, so a token from another call cannot answer.
 */
export type PresenceAskToken = {
  readonly circleId: string;
  readonly checkId: string;
  readonly locale: OfficeLocale;
  /** How many times the person was asked again after silence or an unclear answer: 0 or 1. */
  readonly reasked: number;
};

export const PRESENCE_ASK_TOKEN_TTL_MS = 20 * 60 * 1000;
export const MAX_PRESENCE_ASK_REASKS = 1;
export const PRESENCE_ASK_ROUTES = { answer: "/voice/presence/ask/answer", turn: "/voice/presence/ask/turn", status: "/voice/presence/ask/status" } as const;
const KIND = "presence_ask";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sealPresenceAskToken(token: PresenceAskToken, key: string, now: number): string {
  return sealToken({ kind: KIND, ...token, exp: now + PRESENCE_ASK_TOKEN_TTL_MS }, key);
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The token's contents, or `null` when it is forged, expired, another kind of token or malformed. */
export function openPresenceAskToken(text: string, key: string, now: number): PresenceAskToken | null {
  const payload = openToken(text, key);
  if (!isObject(payload) || payload["kind"] !== KIND) return null;
  const { circleId, checkId, locale, reasked, exp } = payload;
  if (typeof exp !== "number" || exp <= now) return null;
  if (typeof circleId !== "string" || !UUID.test(circleId) || typeof checkId !== "string" || !UUID.test(checkId)) return null;
  if (typeof locale !== "string" || !isOfficeLocale(locale)) return null;
  if (typeof reasked !== "number" || !Number.isInteger(reasked) || reasked < 0 || reasked > MAX_PRESENCE_ASK_REASKS) return null;
  return { circleId, checkId, locale, reasked };
}

/** The address of one of the routes, carrying the sealed token. `publicUrl` has no trailing slash, as `KIN_VOICE_PUBLIC_URL` has none. */
export function presenceAskUrl(publicUrl: string, route: keyof typeof PRESENCE_ASK_ROUTES, token: string): string {
  return `${publicUrl.replace(/\/+$/, "")}${PRESENCE_ASK_ROUTES[route]}?s=${encodeURIComponent(token)}`;
}
