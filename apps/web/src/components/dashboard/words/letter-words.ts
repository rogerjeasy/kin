import type { Reading } from "@kin/documents";
import type { ClaimReason, ClaimResult, ClaimVerdict } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

/**
 * What Kin says about a letter or a demand is filled from the record with
 * fixed wording, so every amount, day and name it speaks is the one the
 * screen shows (AGENTS.md section 7). A model may only rephrase it, and only
 * through the number guard.
 */

/** What became of a letter's bill: put on the list, found to repeat one already there, or not a bill to list. */
export type LetterOutcome = "added" | "duplicate" | "none";

export function letterWords(dictionary: Dictionary, format: Formatters, reading: Reading, outcome: LetterOutcome): string {
  const { spoken, result } = dictionary.dashboard.letters;
  const sender = reading.sender ?? result.unknownSender;
  const amount = reading.amountCents === null ? "" : format.money(reading.amountCents);
  if (reading.pressure) return fill(reading.amountCents === null ? spoken.pressureNoAmount : spoken.pressureAmount, { sender, amount });
  if (reading.kind === "bill" && reading.amountCents !== null) {
    if (reading.sender === null) return fill(spoken.billUnnamed, { amount });
    const due = reading.dueOn === null ? "" : fill(spoken.due, { day: format.day(reading.dueOn) });
    return fill(outcome === "duplicate" ? spoken.billDuplicate : spoken.billAdded, { sender, amount, due });
  }
  if (reading.kind === "receipt") return fill(reading.amountCents === null ? spoken.receiptNoAmount : spoken.receipt, { sender, amount });
  return fill(spoken.letter, { sender });
}

export type ClaimWordsInput = {
  readonly payee: string;
  readonly claimedCents: number | null;
  readonly result: ClaimResult;
};

const CLAIM_TEMPLATE = {
  open_bill: "openBill",
  already_paid: "alreadyPaid",
  unknown_payee: "unknownPayee",
  amount_differs: "amountDiffers",
  no_amount: "noAmount",
} as const satisfies Record<ClaimReason, string>;

/** The fixed sentence for a verdict, and the figures in it, which are the only numbers a model's wording may use. */
export function claimWords(dictionary: Dictionary, format: Formatters, { payee, claimedCents, result }: ClaimWordsInput): { text: string; figures: string[] } {
  const { claim } = dictionary.dashboard.letters;
  const claimed = claimedCents === null ? claim.someMoney : format.money(claimedCents);
  const paid = result.lastPayment === null ? "" : format.money(result.lastPayment.cents);
  const paidDay = result.lastPayment === null ? "" : format.day(result.lastPayment.day);
  const figures = [claimed, paid, paidDay, payee].filter((each) => each !== "");
  return { text: fill(claim[CLAIM_TEMPLATE[result.reason]], { payee, claimed, paid, paidDay }), figures };
}

/** The key under which a verdict's narration is stored. */
export const CLAIM_TOPIC = { no_match: "falseDemand", match: "claimMatch", unclear: "claimUnclear" } as const satisfies Record<ClaimVerdict, string>;

/** A language's name in English, for telling a model which language to word a sentence in. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", fr: "French", de: "German", it: "Italian", es: "Spanish", ar: "Arabic", he: "Hebrew" };
