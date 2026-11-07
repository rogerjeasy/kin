import { ModelUnavailableError, MAX_DOCUMENT_TEXT, narrate, readDocument, type StructuredImage, type StructuredModel } from "@kin/agent";
import { authorize, type BillingAccount } from "@kin/auth";
import { LetterError, addLetter, asPerson, recordClaimCheck, type CircleSnapshot, type Database } from "@kin/db";
import { needsAction, readLetterText, settleReading, MAX_DOCUMENT_CENTS, type Reading } from "@kin/documents";
import { InvalidDecimalError, calendarDay, centsFromDecimal, checkClaim, entryHeadline, sameName, type ClaimVerdict } from "@kin/domain";

import { CLAIM_TOPIC, LANGUAGE_NAMES, claimWords, letterWords, type LetterOutcome } from "@/components/dashboard/words/letter-words";
import { circleFormatters } from "@/content/circle/format";
import { getDictionary } from "@/i18n/dictionary";
import { isLocale } from "@/i18n/locales";

import { spendUse, type RateLimiter } from "./model";

export type LettersContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
  readonly accountTypes: BillingAccount;
  /** Claude, to read a photograph or word a verdict; `null` when this deployment has none. */
  readonly model?: StructuredModel | null;
  readonly limiter?: RateLimiter;
  readonly budget?: RateLimiter;
  readonly now?: () => number;
};

export type LetterFailure = "refused" | "invalid" | "amount" | "image_too_large" | "unreadable" | "model_unavailable" | "model_refused" | "busy";

/** What the screen shows of a reading: only checked fields, never the raw model answer. */
export type ShownReading = Pick<Reading, "kind" | "sender" | "amountCents" | "dueOn" | "pressure" | "source">;

export type LetterResult =
  | { readonly ok: true; readonly documentId: string; readonly billId: string | null; readonly outcome: LetterOutcome; readonly reading: ShownReading; readonly words: string }
  | { readonly ok: false; readonly reason: LetterFailure };

export type DemandResult =
  | { readonly ok: true; readonly claimCheckId: string; readonly verdict: ClaimVerdict; readonly words: string; readonly told: number }
  | { readonly ok: false; readonly reason: LetterFailure };

/** Stands for the payee's name while a model words a verdict, so the name is never part of its instructions. */
const PAYEE_TOKEN = "«payee»";

const fail = (reason: LetterFailure): { readonly ok: false; readonly reason: LetterFailure } => ({ ok: false, reason });

/** A photograph's base64 text may be at most this long: about 3 MB of picture. */
export const MAX_IMAGE_BASE64 = 4_000_000;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_NAME = 80;
const MAX_WHAT_THEY_SAID = 400;

/** The picture's own first bytes must agree with the format it claims. */
function looksLike(mediaType: StructuredImage["mediaType"], base64: string): boolean {
  const head = Buffer.from(base64.slice(0, 24), "base64");
  if (mediaType === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mediaType === "image/png") return head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
}

function parseImage(value: unknown): StructuredImage | null | "too_large" | "invalid" {
  if (value === undefined || value === null) return null;
  const row = object(value);
  if (!row || !keys(row, ["mediaType", "base64"]) || typeof row.base64 !== "string") return "invalid";
  const mediaType = MEDIA_TYPES.find((each) => each === row.mediaType);
  if (mediaType === undefined || row.base64 === "" || !BASE64.test(row.base64)) return "invalid";
  if (row.base64.length > MAX_IMAGE_BASE64) return "too_large";
  return looksLike(mediaType, row.base64) ? { mediaType, base64: row.base64 } : "invalid";
}

/**
 * The parent (or an organizer or contributor) holds up a letter, bill or
 * receipt, as a photograph, as words, or both. Claude reads it with no tools
 * and every field is checked against the source; a bill from a sender Kin can
 * name is put on the list to be reviewed, never paid. What Kin then says is
 * fixed wording filled from that reading.
 */
export async function readLetter(context: LettersContext, input: unknown): Promise<LetterResult> {
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "letter.read").allowed) return fail("refused");
  const row = object(input);
  if (!row || !keys(row, ["text", "image", "locale"]) || typeof row.locale !== "string" || !isLocale(row.locale)) return fail("invalid");
  const locale = row.locale;
  if (row.text !== undefined && row.text !== null && typeof row.text !== "string") return fail("invalid");
  const text = typeof row.text === "string" && row.text.trim() !== "" ? row.text.trim() : null;
  if (text !== null && text.length > MAX_DOCUMENT_TEXT) return fail("invalid");
  const image = parseImage(row.image);
  if (image === "too_large") return fail("image_too_large");
  if (image === "invalid") return fail("invalid");
  if (text === null && image === null) return fail("invalid");

  const { circle } = context;
  const today = calendarDay(circle.circle.now, circle.circle.timezone).occurredOn;
  const reading = await read(context, { text, image, today });
  if (typeof reading === "string") return fail(reading);

  const actionable = needsAction(reading);
  const payee = actionable && reading.sender !== null ? circle.payees.find((each) => each.payee.member === null && sameName(each.name, reading.sender ?? "")) : undefined;
  let recorded: Awaited<ReturnType<typeof recordLetter>>;
  try {
    recorded = await recordLetter(context, reading, actionable, payee?.id ?? null);
  } catch (error) {
    if (error instanceof LetterError) return fail(error.reason);
    throw error;
  }
  const outcome: LetterOutcome = recorded.billId === null ? "none" : recorded.billState === "duplicate" ? "duplicate" : "added";
  const dictionary = await getDictionary(locale);
  const words = letterWords(dictionary, circleFormatters(locale, circle), reading, outcome);
  const { kind, sender, amountCents, dueOn, pressure, source } = reading;
  return { ok: true, documentId: recorded.documentId, billId: recorded.billId, outcome, reading: { kind, sender, amountCents, dueOn, pressure, source }, words };
}

async function read(context: LettersContext, { text, image, today }: { text: string | null; image: StructuredImage | null; today: string }): Promise<Reading | LetterFailure> {
  const { currency } = context.circle.circle;
  const model = context.model ?? null;
  const byRules = () => (text === null ? "model_unavailable" : readLetterText(text, { currency }));
  if (model === null) return byRules();
  if (!spendUse(context, context, (context.now ?? Date.now)())) return "busy";
  try {
    const result = await readDocument(model, { text, image, today, currency });
    if (result.kind === "refused") return "model_refused";
    if (result.kind === "unreadable") return "unreadable";
    // Against a photograph there are no words to check an answer against, so the reading says so.
    return settleReading(result.reading, { text: image === null ? text : null, currency, today });
  } catch (error) {
    // Typed words can still be read by plain rules; a photograph cannot.
    if (error instanceof ModelUnavailableError) return byRules();
    throw error;
  }
}

function recordLetter(context: LettersContext, reading: Reading, actionable: boolean, payeeId: string | null) {
  return asPerson(context.db, context.userId, (tx) =>
    addLetter(tx, {
      circleId: context.circle.circle.id,
      kind: reading.kind,
      payeeId,
      sender: actionable ? reading.sender : null,
      amountCents: actionable ? reading.amountCents : null,
      dueOn: reading.dueOn,
      extraction: reading,
      confidence: reading.confidence,
    }),
  );
}

/**
 * Someone demands money by phone, letter or message, and a member asks Kin
 * to check it. Plain code compares it with what was billed and paid; the
 * model may only word the verdict, through the number guard, falling back
 * to fixed wording. The check is recorded and every member who sees the
 * circle's money is told.
 */
export async function checkDemand(context: LettersContext, input: unknown): Promise<DemandResult> {
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "claim.check").allowed) return fail("refused");
  const row = object(input);
  if (!row || !keys(row, ["payee", "amount", "claim", "locale"]) || typeof row.locale !== "string" || !isLocale(row.locale)) return fail("invalid");
  if (typeof row.payee !== "string" || typeof row.amount !== "string" || typeof row.claim !== "string") return fail("invalid");
  const locale = row.locale;
  const payee = row.payee.replace(/\s+/g, " ").trim();
  const said = row.claim.trim();
  if (payee === "" || payee.length > MAX_NAME || said.length > MAX_WHAT_THEY_SAID) return fail("invalid");
  const claimedCents = claimedAmount(row.amount, context.circle.circle.currency);
  if (claimedCents === "invalid") return fail("amount");

  const { circle } = context;
  const result = checkClaim({
    claimedPayee: payee,
    claimedCents,
    payees: circle.payees.map((each) => ({ id: each.id, name: each.name })),
    bills: circle.bills.map((bill) => ({ payeeId: bill.payeeId, cents: bill.amountCents, state: bill.state })),
    payments: circle.ledger.entries.flatMap((entry) => {
      if (entry.kind !== "payout_confirmed") return [];
      const headline = entryHeadline(entry);
      return [{ entryId: entry.id, payeeId: headline.subject, cents: headline.cents, day: entry.occurredOn }];
    }),
  });

  const dictionary = await getDictionary(locale);
  const formatters = circleFormatters(locale, circle);
  const fixed = claimWords(dictionary, formatters, { payee, claimedCents, result });
  // The name is free text from a person, and a scammer's own words, so the model never sees it: it words a
  // statement holding a token, the name goes in afterwards, and wording that loses the token falls back to the fixed sentence.
  const worded = claimWords(dictionary, formatters, { payee: PAYEE_TOKEN, claimedCents, result });
  // The model is asked only when this person and this server still have a use left; otherwise the fixed wording stands.
  const model = context.model ?? null;
  const narration = await narrate(
    model !== null && spendUse(context, context, (context.now ?? Date.now)()) ? model : null,
    { figures: worded.figures.filter((figure) => figure !== PAYEE_TOKEN), statement: worded.text, language: LANGUAGE_NAMES[locale] },
    worded.text,
  );
  const wording = { text: (narration.text.includes(PAYEE_TOKEN) ? narration.text : fixed.text).replaceAll(PAYEE_TOKEN, () => payee) };

  try {
    const claimCheckId = await asPerson(context.db, context.userId, (tx) =>
      recordClaimCheck(tx, {
        circleId: circle.circle.id,
        payeeId: result.payeeId,
        claimedCents,
        claim: said === "" ? payee : `${payee}: ${said}`,
        foundEntryId: result.lastPayment?.entryId ?? null,
        verdict: result.verdict,
        topic: CLAIM_TOPIC[result.verdict],
        spoken: wording.text,
      }),
    );
    const told = circle.members.filter((member) => member.status === "active" && member.role !== "caregiver").length;
    return { ok: true, claimCheckId, verdict: result.verdict, words: wording.text, told };
  } catch (error) {
    if (error instanceof LetterError) return fail(error.reason);
    throw error;
  }
}

function claimedAmount(text: string, currency: string): number | null | "invalid" {
  const plain = text.trim();
  if (plain === "") return null;
  try {
    const cents = centsFromDecimal(plain, currency);
    return cents > 0 && cents <= MAX_DOCUMENT_CENTS ? cents : "invalid";
  } catch (error) {
    if (error instanceof InvalidDecimalError) return "invalid";
    throw error;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function keys(row: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(row).every((key) => allowed.includes(key));
}
