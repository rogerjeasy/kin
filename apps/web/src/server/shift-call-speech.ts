import { authorize } from "@kin/auth";
import { isSpeechLocale } from "@kin/speech";

import { simulatedCall, type SimulatedCall } from "./shift-call-simulation";
import { say, type Failure, type Spoken, type SpeechContext } from "./speech-actions";

/** The parts of the simulated call Kin can read aloud, one at a time, as the call itself speaks them. */
export const CALL_SPEECH_PARTS = ["question", "confirmed", "declined"] as const;
export type CallSpeechPart = (typeof CALL_SPEECH_PARTS)[number];

const fail = (reason: Failure["reason"]): Failure => ({ ok: false, reason });

/** The sentences of a part, in the order the call speaks them: the opening and the question come together, since one call says both. */
export function partSentences(call: SimulatedCall, part: CallSpeechPart): readonly string[] {
  return part === "question" ? [...call.opening, call.question] : call[part];
}

/**
 * Reads the simulated call aloud, built here from the record by the call's own
 * function and never from text sent in. Demo circles only, and only to those
 * who may give the family's word, since the call exists to ask for it.
 */
export async function sayShiftCall(context: SpeechContext, input: { shiftId: unknown; part: unknown; locale: string }): Promise<Spoken | Failure> {
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "shift.confirm").allowed) return fail("refused");
  const part = CALL_SPEECH_PARTS.find((each) => each === input.part);
  if (part === undefined || !isSpeechLocale(input.locale)) return fail("invalid");
  const simulated = simulatedCall(context.circle, input.shiftId, input.locale);
  if (!simulated.ok) return fail(simulated.reason === "wrong_state" ? "closed" : simulated.reason);
  return say(context, partSentences(simulated.call, part).join(" "), input.locale);
}
