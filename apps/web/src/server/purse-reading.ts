import { ModelUnavailableError, readGift, type StructuredModel } from "@kin/agent";
import type { PursePayeeRecord } from "@kin/db";
import { MAX_PURSE_MEMO_CHARS, accountCents, sameName, type PurseRoute } from "@kin/domain";

/**
 * Her words, read into one payment: who, how much, what for and how. Claude,
 * when the deployment has it, copies the facts out of her words (each must be
 * found in them); without it, or when it is unavailable, plain rules read the
 * same words. Either way the payee is found in her address book by plain code,
 * and the amount is read from her words by the money core.
 */
export type PurseReading = {
  /** The address-book entry she named, verified or not, or `null` for someone not in it. */
  readonly payee: PursePayeeRecord | null;
  /** Who it is for: the entry's name, or her words for someone not in the book. */
  readonly payeeName: string | null;
  readonly cents: number | null;
  readonly memo: string | null;
  readonly route: PurseRoute | null;
  /** Whether Claude read it, or the rules did. */
  readonly readBy: "model" | "rules";
};

const fold = (text: string): string => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[‘’]/g, "'");

/** Every name in her book that appears in her words, as a whole word. */
function namedInWords(words: string, payees: readonly PursePayeeRecord[]): PursePayeeRecord[] {
  const said = ` ${fold(words).replace(/[^\p{L}\p{N}']+/gu, " ")} `;
  return payees.filter((payee) => [payee.name, ...payee.aliases].some((name) => {
    const folded = fold(name).replace(/[^\p{L}\p{N}']+/gu, " ").trim();
    return folded.length > 0 && said.includes(` ${folded} `);
  }));
}

const wordsOf = (text: string): string[] => fold(text).split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");

/**
 * Whether a name she said is an entry's name or one of its other spellings:
 * the same words ("Sam" is Sam), or every word of the shorter in the longer
 * ("St. Mary's" is St. Mary's Church). A word the two merely start with never
 * makes a match, so "the man from the bank" is nobody in her book.
 */
function namesAgree(said: string, name: string): boolean {
  const left = wordsOf(said);
  const right = wordsOf(name);
  if (left.length === 0 || right.length === 0) return false;
  return (left.length === right.length && left.every((word, index) => word === right[index])) || sameName(said, name);
}

/** The person or place her words name, by the family's list: one entry, or none. Kin never guesses between two. */
export function findPayee(name: string | null, relationship: string | null, words: string, payees: readonly PursePayeeRecord[]): PursePayeeRecord | null {
  if (name !== null) {
    const named = payees.filter((payee) => [payee.name, ...payee.aliases].some((each) => namesAgree(name, each)));
    return named.length === 1 ? (named[0] ?? null) : null;
  }
  if (relationship !== null) {
    const related = payees.filter((payee) => namesAgree(relationship, payee.relationship));
    if (related.length === 1) return related[0] ?? null;
  }
  const named = namedInWords(words, payees);
  return named.length === 1 ? (named[0] ?? null) : null;
}

// English shapes only: "... to the man from the bank for ...". Other languages rely on the address book or on Claude.
const TO_SOMEONE = /\bto\s+(.{2,60}?)(?=\s+for\b|\s+in\b|[.!?,]|$)/iu;
const FOR_SOMETHING = /\b(for\s+.{2,80}?)[.!?]*$/iu;

/** The rules' own reading, used when Claude is not there or cannot be used. */
function byRules(words: string, payees: readonly PursePayeeRecord[], currency: string, language: string): PurseReading {
  const payee = findPayee(null, null, words, payees);
  const memo = FOR_SOMETHING.exec(words)?.[1]?.trim() ?? null;
  return {
    payee,
    payeeName: payee?.name ?? TO_SOMEONE.exec(words)?.[1]?.trim() ?? null,
    cents: accountCents(words, currency, language),
    memo: memo !== null && memo.length <= MAX_PURSE_MEMO_CHARS ? memo : null,
    route: null,
    readBy: "rules",
  };
}

export async function readPurseWords(model: StructuredModel | null, words: string, payees: readonly PursePayeeRecord[], currency: string, language: string): Promise<PurseReading> {
  if (model === null) return byRules(words, payees, currency, language);
  let result;
  try {
    result = await readGift(model, words);
  } catch (error) {
    if (error instanceof ModelUnavailableError) return byRules(words, payees, currency, language);
    throw error;
  }
  if (result.kind !== "fields") return byRules(words, payees, currency, language);
  const { fields } = result;
  const payee = findPayee(fields.payeeName, fields.relationship, words, payees);
  return {
    payee,
    payeeName: payee?.name ?? fields.payeeName,
    cents: accountCents(fields.amountText, currency, language) ?? accountCents(words, currency, language),
    memo: fields.memo,
    route: fields.route,
    readBy: "model",
  };
}
