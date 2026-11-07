import { authorize } from "@kin/auth";
import { LetterError, asPerson, readOfficeCalls, recordOfficeCall, type CircleSnapshot, type Database, type OfficeCallRecord, type TranscriptTurn } from "@kin/db";
import { MAX_ANSWER_CHARS, MAX_CALLER_TURNS, type ClaimVerdict, type PressureSignal } from "@kin/domain";
import { scriptedLine, takeCall, type CallScript } from "@kin/telephony";

import { CLAIM_TOPIC, claimWords } from "@/components/dashboard/words/letter-words";
import { circleFormatters } from "@/content/circle/format";
import { getDictionary } from "@/i18n/dictionary";
import { isLocale } from "@/i18n/locales";

import { claimRecord } from "./claim-record";

export type OfficeLineContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
};

export type OfficeLineFailure = "refused" | "invalid" | "nothing_to_check";

export type OfficeCallResult =
  | {
      readonly ok: true;
      readonly callId: string;
      readonly claimCheckId: string;
      readonly verdict: ClaimVerdict;
      readonly pressure: readonly PressureSignal[];
      readonly transcript: readonly TranscriptTurn[];
      /** What the family is told, filled from the record. */
      readonly alert: string;
      readonly told: number;
    }
  | { readonly ok: false; readonly reason: OfficeLineFailure };

const fail = (reason: OfficeLineFailure): { readonly ok: false; readonly reason: OfficeLineFailure } => ({ ok: false, reason });

const MAX_NUMBER_CHARS = 32;
const NUMBER = /^[+\d][\d ()-]*$/;
const MAX_SPOKEN_CHARS = 600;
const MAX_CLAIM_CHARS = 500;

/**
 * Plays a call through the same receptionist that answers the phone, with a
 * scripted caller standing in for the telephone line: the "try the office
 * line" screen. Kin says only the fixed sentences of the circle's language;
 * the verdict comes from plain code over the record; the family's alert is
 * filled from the record. The call is recorded as simulated. No money moves
 * and nothing about the circle is said to the caller.
 */
export async function placeOfficeCall(context: OfficeLineContext, input: unknown): Promise<OfficeCallResult> {
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "office_line.try").allowed) return fail("refused");
  const row = object(input);
  if (!row || !Object.keys(row).every((key) => ["locale", "lines", "number"].includes(key))) return fail("invalid");
  if (typeof row.locale !== "string" || !isLocale(row.locale)) return fail("invalid");
  const locale = row.locale;
  const lines = callerLines(row.lines);
  if (lines === null) return fail("invalid");
  const callerNumber = row.number === undefined || row.number === null || row.number === "" ? null : row.number;
  if (callerNumber !== null && (typeof callerNumber !== "string" || callerNumber.length > MAX_NUMBER_CHARS || !NUMBER.test(callerNumber))) return fail("invalid");

  const { circle } = context;
  const dictionary = await getDictionary(locale);
  const copy = dictionary.dashboard.officeLine;
  const outcome = await takeCall({ line: scriptedLine(lines), script: copy.script satisfies CallScript, record: claimRecord(circle), currency: circle.circle.currency });
  if (outcome.verdict === null) return fail("nothing_to_check");
  const { verdict } = outcome;
  const { answers } = outcome.intake;

  const format = circleFormatters(locale, circle);
  const named = verdict.claimedPayee !== "" ? verdict.claimedPayee : (answers.caller ?? copy.unknownCaller);
  const base = claimWords(dictionary, format, { payee: named, claimedCents: verdict.claimedCents, result: verdict.result }).text;
  const alert = (verdict.pressure.length === 0 ? base : `${base} ${copy.pressureNote}`).slice(0, MAX_SPOKEN_CHARS);

  try {
    const recorded = await asPerson(context.db, context.userId, (tx) =>
      recordOfficeCall(tx, {
        circleId: circle.circle.id,
        callerNumber: callerNumber === null ? null : String(callerNumber),
        callerName: answers.caller,
        organization: answers.organization,
        claimedCents: verdict.claimedCents,
        purpose: answers.purpose,
        reference: answers.reference,
        transcript: outcome.transcript,
        pressureSignals: verdict.pressure,
        simulated: true,
        payeeId: verdict.result.payeeId,
        foundEntryId: verdict.result.lastPayment?.entryId ?? null,
        verdict: verdict.result.verdict,
        topic: CLAIM_TOPIC[verdict.result.verdict],
        spoken: alert,
        claim: `${named}: ${answers.purpose ?? copy.noPurpose}`.slice(0, MAX_CLAIM_CHARS),
      }),
    );
    const told = circle.members.filter((member) => member.status === "active" && member.role !== "caregiver").length;
    return { ok: true, ...recorded, verdict: verdict.result.verdict, pressure: verdict.pressure, transcript: outcome.transcript, alert, told };
  } catch (error) {
    if (error instanceof LetterError) return fail(error.reason);
    throw error;
  }
}

/** The circle's recent calls to the office line, for the screen. The database decides who may read them. */
export function recentOfficeCalls(context: OfficeLineContext): Promise<OfficeCallRecord[]> {
  return asPerson(context.db, context.userId, (tx) => readOfficeCalls(tx, context.circle.circle.id));
}

function callerLines(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CALLER_TURNS) return null;
  return value.every((each): each is string => typeof each === "string" && each.length <= MAX_ANSWER_CHARS) ? value : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
