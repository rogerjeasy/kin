import { caregiverAccess, authorize, type BillingAccount } from "@kin/auth";
import { ProposalClosedError, answerProposal, asPerson, type CircleSnapshot, type Database } from "@kin/db";
import { CaregiverBillError, calculateCaregiverBill, spokenAnswer, type SpokenAnswer } from "@kin/domain";
import { MAX_RECORDING_BYTES, SpeechUnavailableError, isSpeechLocale, type SpeechLocale } from "@kin/speech";
import { createHash } from "node:crypto";

import { answerReadBack, billReadBack, proposalReadBack } from "@/components/dashboard/words/speech-words";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { circleSlots } from "@/content/circle/words";
import { getDictionary } from "@/i18n/dictionary";

import { spendUse, type RateLimiter } from "./model";
import type { SpeechServices } from "./speech";

export type SpeechContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
  readonly accountTypes: BillingAccount;
  readonly services: SpeechServices | null;
  readonly limiter?: RateLimiter;
  readonly budget?: RateLimiter;
  readonly now?: () => number;
};

export type SpeechFailure = "refused" | "invalid" | "speech_unavailable" | "recording" | "busy" | "no_voice" | "closed" | "unclear" | "not_confirmed";
export type Failure = { readonly ok: false; readonly reason: SpeechFailure };
export type Spoken = { readonly ok: true; readonly audio: Uint8Array; readonly contentType: "audio/mpeg" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (reason: SpeechFailure): Failure => ({ ok: false, reason });

/**
 * Turns a recording into words, and says whether they are a clear yes or no.
 * The caregiver's own speech only fills their form or confirms a bill they
 * could submit with a button; it decides nothing on its own.
 */
export async function transcribe(context: SpeechContext, recording: { pcm: Uint8Array; locale: string }): Promise<{ ok: true; transcript: string; answer: SpokenAnswer } | Failure> {
  if (!mayBill(context) && !mayAnswer(context)) return fail("refused");
  const heard = await hear(context, recording);
  return "transcript" in heard ? { ok: true, transcript: heard.transcript, answer: spokenAnswer(heard.transcript, recording.locale) } : heard;
}

/** Reads a caregiver's reviewed bill aloud, recalculated here from its details, never from text sent in. */
export async function sayBill(context: SpeechContext, input: { details: unknown; locale: string }): Promise<Spoken | Failure> {
  if (!mayBill(context)) return fail("refused");
  const payee = context.circle.payees.find((each) => each.payee.member?.memberId === context.circle.viewer.memberId && each.caregiverRateCentsPerHour !== null);
  if (!payee || !isSpeechLocale(input.locale)) return fail("invalid");
  let text: string;
  try {
    const bill = calculateCaregiverBill(input.details);
    if (bill.details.currency !== context.circle.circle.currency || bill.details.rateCentsPerHour !== payee.caregiverRateCentsPerHour) return fail("invalid");
    const dictionary = await getDictionary(input.locale);
    text = billReadBack(dictionary.dashboard.caregiverBilling.speech, input.locale, circleFormatters(input.locale, context.circle), payee.name, bill);
  } catch (error) {
    if (error instanceof CaregiverBillError) return fail("invalid");
    throw error;
  }
  return say(context, text, input.locale);
}

/** Reads a waiting proposal aloud, or the answer Kin heard to it, to a member who may answer it. */
export async function sayProposal(context: SpeechContext, input: { proposalId: string; locale: string; decision: "approve" | "reject" | null }): Promise<Spoken | Failure> {
  const proposal = answerable(context, input.proposalId);
  if (proposal === null || !isSpeechLocale(input.locale)) return fail(proposal === null ? "refused" : "invalid");
  const dictionary = await getDictionary(input.locale);
  const format = circleFormatters(input.locale, context.circle);
  const names = circleNames(context.circle, dictionary);
  const text = input.decision === null
    ? proposalReadBack(dictionary, names, format, proposal, circleSlots(context.circle, format).month)
    : answerReadBack(dictionary, names, format, proposal, input.decision);
  return say(context, text, input.locale);
}

/**
 * A spoken answer to a proposal, in the demo only: a yes to real money needs
 * the fresh multi-factor check, which a voice in the browser cannot give.
 * Kin hears the answer, reads it back, and records it only when the person
 * then says a clear yes (docs/architecture.md section 10.5). The decision is
 * the plain reading of their words, and the approval engine decides the rest.
 */
export async function answerByVoice(
  context: SpeechContext,
  input: { proposalId: string; pcm: Uint8Array; locale: string; step: "answer" | "confirm"; decision: "approve" | "reject" | null },
): Promise<{ ok: true; decision: "approve" | "reject"; outcome: "heard" | "approved" | "rejected" | "answered" } | Failure> {
  if (!context.circle.circle.demo) return fail("refused");
  const proposal = answerable(context, input.proposalId);
  if (proposal === null) return fail("refused");
  const heard = await hear(context, input);
  if (!("transcript" in heard)) return heard;
  const answer = spokenAnswer(heard.transcript, input.locale);
  if (input.step === "answer") {
    if (answer === "unclear") return fail("unclear");
    return { ok: true, decision: answer === "yes" ? "approve" : "reject", outcome: "heard" };
  }
  if (input.decision === null) return fail("invalid");
  if (answer !== "yes") return fail("not_confirmed");
  const decision = input.decision;
  const evidenceRef = `voice:${createHash("sha256").update(heard.transcript).digest("hex").slice(0, 16)}`;
  const seat = { circleId: context.circle.circle.id, memberId: context.circle.viewer.memberId, role: context.circle.viewer.role };
  try {
    const result = await asPerson(context.db, context.userId, (tx) =>
      answerProposal(tx, seat, { proposalId: proposal.id, decision, method: "voice", evidenceRef, now: context.circle.circle.now, pausedUntil: context.circle.circle.pausedUntil }),
    );
    return { ok: true, decision, outcome: result === "approved" ? "approved" : result === "rejected" ? "rejected" : "answered" };
  } catch (error) {
    if (error instanceof ProposalClosedError) return fail("closed");
    throw error;
  }
}

function mayBill(context: SpeechContext): boolean {
  return caregiverAccess({ role: context.circle.viewer.role, status: "active" }, "caregiver_bill.submit", context.accountTypes);
}

function mayAnswer(context: SpeechContext): boolean {
  return authorize({ role: context.circle.viewer.role, status: "active" }, "proposal.answer").allowed;
}

function answerable(context: SpeechContext, proposalId: string) {
  if (!UUID.test(proposalId) || !mayAnswer(context)) return null;
  return context.circle.proposals.find((each) => each.id === proposalId && each.state === "pending_approval") ?? null;
}

// Every use of a paid service is limited per person and per pool, asked before any is used.
function allowed(context: SpeechContext): boolean {
  return spendUse(context, context, (context.now ?? Date.now)());
}

async function hear(context: SpeechContext, recording: { pcm: Uint8Array; locale: string }): Promise<{ transcript: string } | Failure> {
  if (context.services === null) return fail("speech_unavailable");
  if (!isSpeechLocale(recording.locale)) return fail("invalid");
  // An odd byte count is not 16-bit audio.
  if (recording.pcm.byteLength === 0 || recording.pcm.byteLength > MAX_RECORDING_BYTES || recording.pcm.byteLength % 2 !== 0) return fail("recording");
  if (!allowed(context)) return fail("busy");
  try {
    return { transcript: await context.services.transcriber({ pcm: recording.pcm, locale: recording.locale satisfies SpeechLocale }) };
  } catch (error) {
    if (error instanceof SpeechUnavailableError) return fail("speech_unavailable");
    throw error;
  }
}

export async function say(context: SpeechContext, text: string, locale: SpeechLocale): Promise<Spoken | Failure> {
  if (context.services === null) return fail("speech_unavailable");
  if (!allowed(context)) return fail("busy");
  try {
    const spoken = await context.services.voice({ text, locale });
    return spoken === null ? fail("no_voice") : { ok: true, ...spoken };
  } catch (error) {
    if (error instanceof SpeechUnavailableError) return fail("speech_unavailable");
    throw error;
  }
}
