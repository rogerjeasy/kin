import {
  PresenceError,
  answerPresenceCheck,
  confirmTrustedVoice,
  readPresenceStatus,
  readVoiceConfirmation,
  type Database,
  type PresenceStatus,
  type VoiceConfirmation,
} from "@kin/db";
import type { PresenceAnswer, PresenceState } from "@kin/domain";

import { CHECK_TOKEN, checkLinkLimiter, clientKey } from "./check-link";
import type { RateLimiter } from "./model";
import { readCappedText } from "./request-body";

/**
 * The two public pages a family member opens from a text with nobody signed
 * in: "is this you?" and "confirm this is your number". The link is the
 * credential, so these answer the same way for a token that never existed and
 * one that ran out, are slowed per address in the same bucket as the check-in
 * link, read at most two kilobytes, and log nothing that carries a token. The
 * database does the real checking.
 */

export type LinkProblem = "link" | "busy" | "state" | "unavailable";

export const MAX_PRESENCE_LINK_BYTES = 2_048;
const HEADERS = { "cache-control": "no-store", "referrer-policy": "no-referrer" } as const;
const STATUS: Record<LinkProblem, number> = { link: 403, busy: 429, state: 409, unavailable: 503 };

const reply = (body: unknown, status: number): Response => Response.json(body, { status, headers: HEADERS });
const problem = (reason: LinkProblem, status = STATUS[reason]): Response => reply({ ok: false, reason }, status);

function problemOf(error: unknown): LinkProblem {
  if (error instanceof PresenceError) return error.reason === "wrong_state" || error.reason === "in_progress" ? "state" : "link";
  // Only the kind of fault is logged: never the token, which is the secret.
  console.error(JSON.stringify({ message: "presence_link.unavailable", error: error instanceof Error ? error.name : "unknown" }));
  return "unavailable";
}

/** What the "is this you?" page may be told: first names, the amount asked for and the state. Never an ID, never a number. */
export type PublicPresence = {
  readonly state: PresenceState;
  readonly voiceFirstName: string;
  readonly parentFirstName: string;
  readonly claimedCents: number | null;
  readonly currency: string;
  readonly locale: string;
  readonly simulated: boolean;
  readonly canAnswer: boolean;
};

const publicOf = (status: PresenceStatus): PublicPresence => ({
  state: status.state,
  voiceFirstName: status.voiceFirstName,
  parentFirstName: status.parentFirstName,
  claimedCents: status.claimedCents,
  currency: status.currency,
  locale: status.locale,
  simulated: status.simulated,
  canAnswer: status.canAnswer,
});

export type PresenceLinkDeps = {
  readonly read: (token: string) => Promise<PresenceStatus>;
  readonly answer: (input: { readonly token: string; readonly answer: PresenceAnswer }) => Promise<{ readonly state: PresenceState; readonly changed: boolean }>;
  readonly limiter: RateLimiter;
  readonly now: () => number;
};

export function presenceLinkDeps(db: () => Database): PresenceLinkDeps {
  return { read: (token) => readPresenceStatus(db(), token), answer: (input) => answerPresenceCheck(db(), input), limiter: checkLinkLimiter, now: Date.now };
}

export type PresenceLinkView = { readonly ok: true; readonly status: PublicPresence } | { readonly ok: false; readonly reason: Extract<LinkProblem, "link" | "busy" | "unavailable"> };

/** The page's first look at a link, slowed per address before the database is asked. A dead token and a wrong one are both `link`. */
export async function presenceLinkStatus(token: string, headers: Headers, deps: PresenceLinkDeps): Promise<PresenceLinkView> {
  const key = clientKey(headers);
  if (!deps.limiter.allows(key, deps.now())) return { ok: false, reason: "busy" };
  deps.limiter.record(key, deps.now());
  if (!CHECK_TOKEN.test(token)) return { ok: false, reason: "link" };
  try {
    return { ok: true, status: publicOf(await deps.read(token)) };
  } catch (error) {
    return { ok: false, reason: problemOf(error) === "link" ? "link" : "unavailable" };
  }
}

/** A body of exactly a token and an answer, or `null`. */
export function parseAnswer(text: string): { readonly token: string; readonly answer: PresenceAnswer } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const { token, answer } = row;
  if (Object.keys(row).length !== 2 || typeof token !== "string" || !CHECK_TOKEN.test(token) || (answer !== "me" && answer !== "not_me")) return null;
  return { token, answer };
}

/**
 * The real person taps "yes, it is me" or "no, it is not me". A "no" holds
 * outgoing money for a day and tells the family; the database does both.
 */
export async function presenceAnswerResponse(request: Request, deps: PresenceLinkDeps): Promise<Response> {
  const key = clientKey(request.headers);
  if (!deps.limiter.allows(key, deps.now())) return problem("busy");
  deps.limiter.record(key, deps.now());
  const text = await readCappedText(request, MAX_PRESENCE_LINK_BYTES);
  const tap = text === null ? null : parseAnswer(text);
  if (tap === null) return problem("link", 400);
  try {
    const result = await deps.answer(tap);
    return reply({ ok: true, state: result.state, changed: result.changed }, 200);
  } catch (error) {
    return problem(problemOf(error));
  }
}

// ---------------------------------------------------------------------------
// "Confirm this is your number"
// ---------------------------------------------------------------------------

export type VoiceLinkDeps = {
  readonly read: (token: string) => Promise<VoiceConfirmation>;
  readonly confirm: (token: string, receiver: string | null) => Promise<VoiceConfirmation>;
  readonly limiter: RateLimiter;
  readonly now: () => number;
};

export function voiceLinkDeps(db: () => Database): VoiceLinkDeps {
  return { read: (token) => readVoiceConfirmation(db(), token), confirm: (token, receiver) => confirmTrustedVoice(db(), token, receiver), limiter: checkLinkLimiter, now: Date.now };
}

export type VoiceLinkView = { readonly ok: true; readonly status: VoiceConfirmation } | { readonly ok: false; readonly reason: Extract<LinkProblem, "link" | "busy" | "unavailable"> };

export async function voiceLinkStatus(token: string, headers: Headers, deps: VoiceLinkDeps): Promise<VoiceLinkView> {
  const key = clientKey(headers);
  if (!deps.limiter.allows(key, deps.now())) return { ok: false, reason: "busy" };
  deps.limiter.record(key, deps.now());
  if (!CHECK_TOKEN.test(token)) return { ok: false, reason: "link" };
  try {
    return { ok: true, status: await deps.read(token) };
  } catch (error) {
    return { ok: false, reason: problemOf(error) === "link" ? "link" : "unavailable" };
  }
}

/** An email as a person types it, kept only if it looks like one: a PayPal account is an address. The database checks it again. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_EMAIL_CHARS = 127;

/** A body of a token and, if they give one, their PayPal account; or `null`. Anything else, an extra field included, is not a confirmation. */
export function parseConfirm(text: string): { readonly token: string; readonly receiver: string | null } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const { token, receiver } = row;
  if (typeof token !== "string" || !CHECK_TOKEN.test(token)) return null;
  const keys = Object.keys(row).length;
  if (keys === 1) return { token, receiver: null };
  if (keys !== 2 || (receiver !== null && typeof receiver !== "string")) return null;
  const email = receiver === null ? null : receiver.trim();
  if (email === null || email === "") return { token, receiver: null };
  return email.length <= MAX_EMAIL_CHARS && EMAIL.test(email) ? { token, receiver: email } : null;
}

export async function voiceConfirmResponse(request: Request, deps: VoiceLinkDeps): Promise<Response> {
  const key = clientKey(request.headers);
  if (!deps.limiter.allows(key, deps.now())) return problem("busy");
  deps.limiter.record(key, deps.now());
  const text = await readCappedText(request, MAX_PRESENCE_LINK_BYTES);
  const confirmation = text === null ? null : parseConfirm(text);
  if (confirmation === null) return problem("link", 400);
  try {
    const done = await deps.confirm(confirmation.token, confirmation.receiver);
    return reply({ ok: true, name: done.name, parentFirstName: done.parentFirstName }, 200);
  } catch (error) {
    return problem(problemOf(error));
  }
}
