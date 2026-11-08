import { parseVoiceRequest, type VoiceRequest } from "../twilio/voice-request.ts";
import type { FormParams } from "../twilio/signature.ts";

/** What Twilio's answering machine detection reports in `AnsweredBy`. https://www.twilio.com/docs/voice/answering-machine-detection */
const ANSWERED_BY = ["human", "machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other", "fax", "unknown"] as const;
export type AnsweredBy = (typeof ANSWERED_BY)[number];

/** The fields of a verified webhook for an outbound shift call. For these calls `to` is the parent and `from` is Kin's number. */
export type ShiftCallRequest = VoiceRequest & {
  /** `null` when Twilio sent none, as it does when machine detection is off. */
  readonly answeredBy: AnsweredBy | null;
};

/** Reads a webhook of the shift call after its signature has been verified; `null` when a field is malformed or repeated. */
export function parseShiftCallRequest(params: FormParams): ShiftCallRequest | null {
  const base = parseVoiceRequest(params);
  if (base === null) return null;
  const answeredBy = params.find(([name]) => name === "AnsweredBy")?.[1];
  return { ...base, answeredBy: answeredBy !== undefined && (ANSWERED_BY as readonly string[]).includes(answeredBy) ? (answeredBy as AnsweredBy) : null };
}

/**
 * Whether a person is on the line. A machine, or a fax, is never asked the
 * question: the names of the family are not read onto a voicemail. A request
 * with no verdict, or with `unknown`, is treated as a person, because the
 * question holds no money detail and the parent can hang up.
 */
export const isPerson = (answeredBy: AnsweredBy | null): boolean => answeredBy === null || answeredBy === "human" || answeredBy === "unknown";

/** How a finished call ended, in the terms of the domain's shift-call states. `completed` says nothing about whether a word was given. */
export type CallEnd = "completed" | "no_answer" | "failed";

/** The end of the call a status callback reports, or `null` while it is still going. */
export function callEnd(callStatus: string | null): CallEnd | null {
  switch (callStatus) {
    case "completed":
      return "completed";
    case "busy":
    case "no-answer":
      return "no_answer";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return null;
  }
}
