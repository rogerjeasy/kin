import { hasHiddenCharacters } from "@kin/domain";

import { hasLinkOrAddress, passesNumberGuard } from "../narrate.ts";
import { numbersIn } from "../number-values.ts";
import type { JsonValue } from "./tool-gateway.ts";

/**
 * Ask Kin's answer guard (docs/architecture.md section 9.6): what a tool
 * returned decides which figures an answer may use, and which person each
 * figure belongs to.
 */

/**
 * Keys under which a tool hands back words people typed or a letter said:
 * names, purposes, items, memos. Their digits are never figures, so "999"
 * inside a payee's name or a proposal's purpose cannot authorise an amount.
 * The answer may still repeat such a text whole, exactly as the record holds it.
 */
export const FREE_TEXT_KEYS: ReadonlySet<string> = new Set(["payee", "to", "about", "member", "knownPayee", "claimedPayee", "purpose", "item", "memo", "readBack", "waitingFor"]);

/** Keys naming the person or payee a row's figures belong to. */
const NAME_KEYS: ReadonlySet<string> = new Set(["member", "to", "payee", "about", "knownPayee", "claimedPayee", "waitingFor"]);

/** The shortest text that is removed whole before the answer's digits are read. Shorter ones could hide a digit. */
const MIN_TEXT_LENGTH = 3;

export type AnswerEvidence = {
  /** Every formatted figure and fixed word the tools returned: their digits authorise digits. */
  readonly figures: readonly string[];
  /** Every free text the tools returned. */
  readonly texts: readonly string[];
  /** For each name a tool returned beside figures, the values of those figures. */
  readonly byName: ReadonlyMap<string, ReadonlySet<string>>;
  /** The values of figures no name was returned beside, such as the pool's balance or the month. */
  readonly unnamed: ReadonlySet<string>;
};

const valuesOf = (texts: readonly string[]) => texts.flatMap(numbersIn).flatMap((number) => number.values);
const isRow = (value: JsonValue): value is { readonly [key: string]: JsonValue } => typeof value === "object" && value !== null && !Array.isArray(value);

/** The figures and free texts in one value; `key` is the key it was found under. */
function split(value: JsonValue, key: string | null, into: { figures: string[]; texts: string[] }): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") into.figures.push(String(value));
  else if (typeof value === "string") (key !== null && FREE_TEXT_KEYS.has(key) ? into.texts : into.figures).push(value);
  else if (Array.isArray(value)) for (const each of value as readonly JsonValue[]) split(each, key, into);
  else for (const [inner, each] of Object.entries(value)) split(each, inner, into);
}

/** The names a row is about: its name keys' texts. */
function namesOf(row: { readonly [key: string]: JsonValue }): string[] {
  return Object.entries(row).flatMap(([key, value]) => {
    if (!NAME_KEYS.has(key)) return [];
    const list = Array.isArray(value) ? (value as readonly JsonValue[]) : [value];
    return list.filter((each): each is string => typeof each === "string" && each.trim() !== "");
  });
}

/** Walks the rows: a row with a name gives that name every figure inside it; figures outside any named row are unnamed. */
function associate(value: JsonValue, byName: Map<string, Set<string>>, unnamed: Set<string>): void {
  if (Array.isArray(value)) {
    for (const each of value as readonly JsonValue[]) associate(each, byName, unnamed);
    return;
  }
  if (!isRow(value)) {
    for (const each of valuesOf(figuresIn(value))) unnamed.add(each);
    return;
  }
  const names = namesOf(value);
  if (names.length === 0) {
    for (const [key, each] of Object.entries(value)) if (!FREE_TEXT_KEYS.has(key)) associate(each, byName, unnamed);
    return;
  }
  const values = valuesOf(figuresIn(value));
  for (const name of names) {
    const key = name.trim().toLocaleLowerCase();
    byName.set(key, new Set([...(byName.get(key) ?? []), ...values]));
  }
}

function figuresIn(value: JsonValue): string[] {
  const into = { figures: [] as string[], texts: [] as string[] };
  split(value, null, into);
  return into.figures;
}

/** What the tools returned for one question, as the answer guard reads it. */
export function evidenceOf(results: readonly JsonValue[]): AnswerEvidence {
  const into = { figures: [] as string[], texts: [] as string[] };
  const byName = new Map<string, Set<string>>();
  const unnamed = new Set<string>();
  for (const result of results) {
    split(result, null, into);
    associate(result, byName, unnamed);
  }
  return { figures: into.figures, texts: into.texts, byName, unnamed };
}

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
/** `text` as a whole word or phrase, never inside a longer word or number. */
const whole = (text: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(text)}(?![\\p{L}\\p{N}])`, "giu");

/** The sentence without the free texts it repeats whole, so a name's own digits are not read as figures. */
function withoutTexts(sentence: string, texts: readonly string[]): string {
  const removable = [...new Set(texts.map((text) => text.trim()))].filter((text) => text.length >= MIN_TEXT_LENGTH && /\p{L}/u.test(text)).toSorted((a, b) => b.length - a.length);
  return removable.reduce((rest, text) => rest.replace(whole(text), " "), sentence);
}

/**
 * Whether each figure in a sentence that names people belongs to one of them.
 * A figure the tools returned only beside someone else, such as Amara's
 * payout said of Elena, fails; a figure returned beside nobody, such as the
 * pool's balance, may sit beside any name.
 */
function figuresBelong(sentence: string, digits: string, evidence: AnswerEvidence): boolean {
  const mentioned = [...evidence.byName.keys()].filter((name) => whole(name).test(sentence));
  if (mentioned.length === 0) return true;
  const theirs = new Set(mentioned.flatMap((name) => [...(evidence.byName.get(name) ?? [])]));
  const someone = new Set([...evidence.byName.values()].flatMap((values) => [...values]));
  return numbersIn(digits).every((number) => number.values.some((value) => evidence.unnamed.has(value) || theirs.has(value) || !someone.has(value)));
}

const isEvidence = (evidence: readonly string[] | AnswerEvidence): evidence is AnswerEvidence => !Array.isArray(evidence);

/** The longest answer accepted at all; each sentence also meets the narration guard's own limit. */
const MAX_ANSWER_LENGTH = 800;

/**
 * Whether the answer may be shown: every number in it is one the tools
 * returned as a figure (never one inside a name or a purpose), and a figure
 * said beside a person's name is one the tools returned for that person. The
 * guard reads at most a few sentences at a time, so a longer answer is read
 * one sentence at a time, and every sentence must pass. A plain list of
 * texts, as the shift assistant has, holds figures only.
 */
export function answerPassesGuard(text: string, evidence: readonly string[] | AnswerEvidence, language: string): boolean {
  const facts: AnswerEvidence = isEvidence(evidence) ? evidence : { figures: evidence, texts: [], byName: new Map(), unnamed: new Set() };
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > MAX_ANSWER_LENGTH) return false;
  const sentences = trimmed.split(/(?<=[.!?。؟])\s+/u).filter((sentence) => sentence !== "");
  return sentences.every((sentence) => {
    if (hasHiddenCharacters(sentence) || hasLinkOrAddress(sentence)) return false;
    const digits = withoutTexts(sentence, facts.texts);
    // A sentence that only repeats a name has no figure left to check.
    const numbersAllowed = digits.trim() === "" || passesNumberGuard(digits, { figures: facts.figures, texts: facts.texts, language });
    return numbersAllowed && figuresBelong(sentence, digits, facts);
  });
}
