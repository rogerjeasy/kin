import { INTAKE_QUESTIONS, MAX_ANSWER_CHARS, MAX_CALLER_TURNS } from "@kin/domain";

import { isOfficeLocale, type OfficeLocale } from "../office-words.ts";
import { openToken, sealToken } from "./sealed-token.ts";

/**
 * Where a call stands between two webhook turns. Twilio calls Kin afresh for
 * every answer, so the state rides in the address Kin gave Twilio for the next
 * turn, sealed with a key only Kin holds. It names the call and the circle, so
 * a token from one call cannot steer another, and it holds the caller's words
 * only as data to replay through the same receptionist (`replayCall`).
 */
export type CallState = {
  /** Twilio's ID of the call this state belongs to. */
  readonly sid: string;
  /** The one circle the dialled number belongs to. */
  readonly circle: string;
  readonly locale: OfficeLocale;
  readonly from: string | null;
  /** The caller's answers so far, one per question answered, in order. */
  readonly heard: readonly string[];
  /** How many times the caller said nothing. */
  readonly silent: number;
};

export const CALL_SID = /^CA[0-9a-fA-F]{32}$/;
export const PHONE_NUMBER = /^\+?[0-9]{3,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A call is short. A token older than this is a call that should have ended. */
export const CALL_STATE_TTL_MS = 60 * 60 * 1000;

export function sealCallState(state: CallState, key: string, now: number): string {
  return sealToken({ ...state, exp: now + CALL_STATE_TTL_MS }, key);
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The state a token carries, or `null` when it is forged, expired or malformed. */
export function openCallState(token: string, key: string, now: number): CallState | null {
  const payload = openToken(token, key);
  if (!isObject(payload)) return null;
  const { sid, circle, locale, from, heard, silent, exp } = payload;
  if (typeof exp !== "number" || exp <= now) return null;
  if (typeof sid !== "string" || !CALL_SID.test(sid)) return null;
  if (typeof circle !== "string" || !UUID.test(circle)) return null;
  if (typeof locale !== "string" || !isOfficeLocale(locale)) return null;
  if (from !== null && (typeof from !== "string" || !PHONE_NUMBER.test(from))) return null;
  if (!Array.isArray(heard) || heard.length > INTAKE_QUESTIONS.length) return null;
  if (!heard.every((each): each is string => typeof each === "string" && each !== "" && each.length <= MAX_ANSWER_CHARS)) return null;
  if (typeof silent !== "number" || !Number.isInteger(silent) || silent < 0 || silent + heard.length > MAX_CALLER_TURNS) return null;
  return { sid, circle, locale, from, heard, silent };
}
