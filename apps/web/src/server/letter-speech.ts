import { authorize } from "@kin/auth";
import { parseStoredReading } from "@kin/documents";
import { isSpeechLocale } from "@kin/speech";

import { letterWords, type LetterOutcome } from "@/components/dashboard/words/letter-words";
import { circleFormatters } from "@/content/circle/format";
import { getDictionary } from "@/i18n/dictionary";

import { say, type Failure, type Spoken, type SpeechContext } from "./speech-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (reason: Failure["reason"]): Failure => ({ ok: false, reason });

/**
 * Reads a letter Kin has already read aloud again, from the reading stored
 * with its document and the state of its bill, never from text sent in.
 */
export async function sayLetter(context: SpeechContext, input: { documentId: string; locale: string }): Promise<Spoken | Failure> {
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "letter.read").allowed) return fail("refused");
  if (!UUID.test(input.documentId) || !isSpeechLocale(input.locale)) return fail("invalid");
  const document = context.circle.documents.find((each) => each.id === input.documentId);
  const reading = document === undefined ? null : parseStoredReading(document.extraction);
  if (document === undefined || reading === null) return fail("refused");
  const bill = context.circle.bills.find((each) => each.documentId === document.id);
  const outcome: LetterOutcome = bill === undefined ? "none" : bill.state === "duplicate" ? "duplicate" : "added";
  const dictionary = await getDictionary(input.locale);
  return say(context, letterWords(dictionary, circleFormatters(input.locale, context.circle), reading, outcome), input.locale);
}

/**
 * Speaks what Kin told this member about a demand it checked: the wording
 * stored when the check was recorded, after the number guard. Only the
 * member it was told to may hear it, and only if they may see the circle's safety record.
 */
export async function sayClaim(context: SpeechContext, input: { claimCheckId: string; locale: string }): Promise<Spoken | Failure> {
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "safety.view").allowed) return fail("refused");
  if (!UUID.test(input.claimCheckId) || !isSpeechLocale(input.locale)) return fail("invalid");
  const narration = context.circle.narrations.find((each) => each.claimCheckId === input.claimCheckId && each.memberId === context.circle.viewer.memberId);
  if (narration === undefined || narration.spokenText === null) return fail("refused");
  return say(context, narration.spokenText, input.locale);
}
