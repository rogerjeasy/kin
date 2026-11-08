import { SHIFT_CALL_ROUTES, sealShiftCallToken, type ShiftCallToken } from "@kin/telephony";

import { nextTurnPath, type TwilioCaller } from "./twilio-caller.ts";

/** Kin's own number, the caller ID of an outbound call: for these calls `From`. */
export const KIN_NUMBER = "+15555550100";
/** The parent's number, which Twilio dialled: for these calls `To`. */
export const PARENT_NUMBER = "+15555550142";

/** The address of one of the shift call's routes as the worker gives it to Twilio, as a path with its sealed token. */
export function shiftCallPath(route: keyof typeof SHIFT_CALL_ROUTES, token: ShiftCallToken, key: string, now: number): string {
  return `${SHIFT_CALL_ROUTES[route]}?s=${encodeURIComponent(sealShiftCallToken(token, key, now))}`;
}

/** The fields Twilio posts for an outbound call, whatever the webhook. */
export const outboundFields = (callSid: string, extra: Readonly<Record<string, string>> = {}): Record<string, string> => ({
  CallSid: callSid,
  From: KIN_NUMBER,
  To: PARENT_NUMBER,
  AccountSid: "AC00000000000000000000000000000000",
  Direction: "outbound-api",
  ...extra,
});

/** What the parent does at one question: says something, presses a key, or says nothing. */
export type Heard = { readonly speech: string } | { readonly digits: string } | "silence";

/**
 * Plays a shift call as Twilio would: the answer webhook when the parent picks up, then each of her answers to the
 * address Kin gave for the next turn. Returns every TwiML Kin answered with. Stops when Kin hangs up.
 */
export async function playShiftCall(
  caller: TwilioCaller,
  baseUrl: string,
  call: { readonly sid: string; readonly firstPath: string; readonly answeredBy?: string; readonly hears: readonly Heard[] },
): Promise<string[]> {
  const first = await caller.post(call.firstPath, outboundFields(call.sid, { CallStatus: "in-progress", ...(call.answeredBy === undefined ? {} : { AnsweredBy: call.answeredBy }) }));
  const turns: string[] = [first.body];
  for (const heard of call.hears) {
    const path = nextTurnPath(turns.at(-1) ?? "", baseUrl);
    if (path === null) break;
    const fields: Record<string, string> = { CallStatus: "in-progress" };
    if (heard !== "silence") {
      if ("speech" in heard) fields["SpeechResult"] = heard.speech;
      else fields["Digits"] = heard.digits;
    }
    turns.push((await caller.post(path, outboundFields(call.sid, fields))).body);
  }
  return turns;
}
