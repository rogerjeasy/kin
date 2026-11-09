import { MAX_CARE_MINUTES, MAX_CARE_TRIPS, MAX_OFFER_CENTS, addMonths, centsFromDecimal, decimalAmount, isMonth, spokenNumbers } from "@kin/domain";

import { passesNumberGuard } from "./narrate.ts";
import { numbersIn } from "./number-values.ts";
import { SEALED_OFFER_SCHEMA, sealedOfferSystemPrompt, sealedOfferUserMessage, type OfferContext } from "./sealed-offer-prompt.ts";
import { ModelUnavailableError, type StructuredModel } from "./structured-model.ts";

/** How much of a private conversation is sent at once: a few short messages. */
export const MAX_OFFER_MESSAGES = 6;
export const MAX_OFFER_MESSAGE_CHARS = 500;
/** The longest reply shown back. */
export const MAX_OFFER_REPLY_CHARS = 320;
/** How far ahead a step-up or a first month may be. */
const MAX_MONTHS_AHEAD = 12;

/** An offer as the agent drafted it, for the person to check, change and seal. Nothing here is stored. */
export type DraftOffer = {
  readonly monthlyCents: number | null;
  readonly stepUp: { readonly cents: number; readonly fromMonth: string } | null;
  readonly earliestMonth: string | null;
  readonly careTrips: number;
  readonly careMinutes: number;
};

export type ReadOfferResult =
  | {
      readonly kind: "draft";
      readonly draft: DraftOffer;
      /** The agent's words back, or `null` when they failed the number guard and the screen's fixed wording stands. */
      readonly reply: string | null;
      /** Values the model gave that the person never said, and so were dropped. */
      readonly dropped: number;
    }
  | { readonly kind: "refused" }
  | { readonly kind: "unreadable" };

/**
 * Reads what one person said they can give into a draft offer. The model only
 * proposes: every amount, count and hour must be a number the person said, in
 * digits or in words, or it is dropped, so the agent cannot raise or lower
 * anyone's offer; a month must be one of the next twelve. The person sees the
 * draft and seals it themselves. The words are sent once and never kept.
 */
export async function readOffer(model: StructuredModel, messages: readonly string[], context: OfferContext): Promise<ReadOfferResult> {
  const said = messages.map((message) => message.trim()).filter((message) => message !== "");
  if (said.length === 0 || said.length > MAX_OFFER_MESSAGES || said.some((message) => message.length > MAX_OFFER_MESSAGE_CHARS)) return { kind: "unreadable" };
  const reply = await model({ system: sealedOfferSystemPrompt(context), user: sealedOfferUserMessage(said), schema: SEALED_OFFER_SCHEMA });
  if (reply.kind === "refused") return { kind: "refused" };
  if (reply.kind === "cut_off") return { kind: "unreadable" };
  let value: unknown;
  try {
    value = JSON.parse(reply.text);
  } catch (error) {
    throw new ModelUnavailableError("The model's answer was not JSON", { cause: error, kind: "unusable" });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ModelUnavailableError("The model's answer did not follow the schema", { kind: "unusable" });
  const row = value as Record<string, unknown>;

  const words = said.join("\n");
  const heard = new Set([...numbersIn(words).flatMap((number) => number.values), ...spokenNumbers(words, context.language).flatMap((number) => number.readings)]);
  let dropped = 0;
  const drop = <T>(): T | null => {
    dropped += 1;
    return null;
  };
  /** A plain decimal the person said, in whole minor units of `currency`; `null` when absent, and dropped when not theirs. */
  const grounded = (field: unknown, currency: string): number | null => {
    if (field === null || field === undefined) return null;
    if (typeof field !== "string") return drop();
    const [number] = numbersIn(field.trim());
    if (number === undefined || number.written !== field.trim() || !number.values.every((each) => heard.has(each))) return drop();
    try {
      return centsFromDecimal(field.trim(), currency);
    } catch {
      return drop();
    }
  };
  const month = (field: unknown, after: boolean): string | null => {
    if (field === null || field === undefined) return null;
    const latest = addMonths(context.startMonth, MAX_MONTHS_AHEAD);
    if (typeof field !== "string" || !isMonth(field) || field > latest || (after ? field <= context.startMonth : field < context.startMonth)) return drop();
    return field;
  };

  const monthlyCents = inRange(grounded(row["monthly"], context.currency), MAX_OFFER_CENTS, drop);
  const stepCents = inRange(grounded(row["stepUpAmount"], context.currency), MAX_OFFER_CENTS, drop);
  const stepMonth = month(row["stepUpMonth"], true);
  const stepUp = stepCents !== null && stepMonth !== null && stepCents > (monthlyCents ?? 0) ? { cents: stepCents, fromMonth: stepMonth } : null;
  if (stepUp === null && (stepCents !== null || stepMonth !== null)) dropped += 1;
  const trips = row["careTrips"];
  const careTrips = trips === null || trips === undefined ? 0 : typeof trips === "number" && Number.isSafeInteger(trips) && trips >= 0 && trips <= MAX_CARE_TRIPS && heard.has(String(trips)) ? trips : (drop<number>() ?? 0);
  // Hours are read as hundredths, from their digits, so 1.5 hours is exactly 90 minutes.
  const hundredths = grounded(row["careHours"], "USD");
  const careMinutes = hundredths === null ? 0 : Math.min(MAX_CARE_MINUTES, Math.round((hundredths * 60) / 100));

  const text = typeof row["reply"] === "string" ? plain(row["reply"]) : "";
  const figures = [...said, ...[monthlyCents, stepUp?.cents].flatMap((cents) => (cents === null || cents === undefined ? [] : [decimalAmount({ cents, currency: context.currency })]))];
  const safe = text !== "" && text.length <= MAX_OFFER_REPLY_CHARS && passesNumberGuard(text, { figures, language: context.language, maxLength: MAX_OFFER_REPLY_CHARS });
  return {
    kind: "draft",
    draft: { monthlyCents, stepUp, earliestMonth: month(row["earliestMonth"], false), careTrips, careMinutes },
    reply: safe ? text : null,
    dropped,
  };
}

function inRange(cents: number | null, max: number, drop: () => null): number | null {
  if (cents === null) return null;
  return cents >= 0 && cents <= max ? cents : drop();
}

/** Text shown as plain words: tags, stray angle brackets and control characters go. */
function plain(text: string): string {
  return text
    .replaceAll(/<[^>]*>/gu, "")
    .replaceAll(/[<>]/gu, "")
    .replaceAll(/\p{Cc}/gu, " ")
    .replaceAll(/ {2,}/gu, " ")
    .trim();
}
