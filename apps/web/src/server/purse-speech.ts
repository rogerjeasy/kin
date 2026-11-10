import { authorize } from "@kin/auth";
import { asPerson, readPursePayment } from "@kin/db";
import { isSpeechLocale } from "@kin/speech";

import { say, type Failure, type SpeechContext, type Spoken } from "./speech-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Reads one of her Purse payments back aloud to her: the sentence Kin already
 * wrote down for it, which passed the number guard. Never text sent in, and
 * only to the parent, for a payment the database lets her read.
 */
export async function sayPurse(context: SpeechContext, input: { readonly paymentId: unknown; readonly locale: string }): Promise<Spoken | Failure> {
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "purse.spend").allowed) return { ok: false, reason: "refused" };
  if (typeof input.paymentId !== "string" || !UUID.test(input.paymentId) || !isSpeechLocale(input.locale)) return { ok: false, reason: "invalid" };
  const paymentId = input.paymentId;
  const payment = await asPerson(context.db, context.userId, (tx) => readPursePayment(tx, context.circle.circle.id, paymentId));
  if (payment === null) return { ok: false, reason: "refused" };
  return say(context, payment.readBack, input.locale);
}
