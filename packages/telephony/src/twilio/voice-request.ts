import { CALL_SID, PHONE_NUMBER } from "./call-state.ts";
import type { FormParams } from "./signature.ts";

/** A Twilio voice webhook carries about thirty fields; far more is not Twilio. */
export const MAX_FORM_BYTES = 16 * 1024;
const MAX_FORM_FIELDS = 100;
const MAX_FIELD_CHARS = 4096;
const MAX_SPEECH_CHARS = 1000;

/** Only the fields the conversation uses; every other field Twilio sends is ignored after it is signed. */
export type VoiceRequest = {
  readonly callSid: string;
  /** `null` for a withheld or non-telephone caller ID. It is the caller's claim, never an identity. */
  readonly from: string | null;
  /** The number that was dialled: the only thing that picks a circle. */
  readonly to: string;
  /** What the caller said, as Twilio transcribed it; `null` when nothing was heard. */
  readonly speech: string | null;
  readonly digits: string | null;
  readonly callStatus: string | null;
};

const CALL_STATUSES = ["queued", "ringing", "in-progress", "completed", "busy", "failed", "no-answer", "canceled"] as const;
const DIGITS = /^[0-9*#w]{1,32}$/;

/** Reads the fields of a signed voice webhook. `null` when a field is malformed or repeated: the request is refused. */
export function parseVoiceRequest(params: FormParams): VoiceRequest | null {
  if (params.length > MAX_FORM_FIELDS) return null;
  const fields = new Map<string, string>();
  for (const [name, value] of params) {
    if (value.length > MAX_FIELD_CHARS || fields.has(name)) return null;
    fields.set(name, value);
  }
  const callSid = fields.get("CallSid");
  const to = fields.get("To");
  if (callSid === undefined || !CALL_SID.test(callSid) || to === undefined || !PHONE_NUMBER.test(to)) return null;
  const from = fields.get("From");
  const speech = fields.get("SpeechResult")?.trim();
  if (speech !== undefined && speech.length > MAX_SPEECH_CHARS) return null;
  const digits = fields.get("Digits");
  if (digits !== undefined && digits !== "" && !DIGITS.test(digits)) return null;
  const status = fields.get("CallStatus");
  return {
    callSid,
    from: from !== undefined && PHONE_NUMBER.test(from) ? from : null,
    to,
    speech: speech === undefined || speech === "" ? null : speech,
    digits: digits === undefined || digits === "" ? null : digits,
    callStatus: status !== undefined && (CALL_STATUSES as readonly string[]).includes(status) ? status : null,
  };
}
