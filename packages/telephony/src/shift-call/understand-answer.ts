import type { ShiftCallAnswer } from "@kin/domain";

import type { OfficeLocale } from "../office-words.ts";
import { ANSWER_LEXICONS, type AnswerLexicon } from "./answer-lexicon.ts";

/**
 * What the parent said to "was she with you?": `yes`, `no` or `unclear`. Plain
 * code, no model: the answer becomes the family's second key on a payment, so
 * the default is `unclear` and a doubtful answer never counts as a yes.
 *
 * The rules, in order:
 * 1. A key press decides: 1 is yes, 2 is no, any other key is unclear. Speech
 *    that contradicts the key makes it unclear.
 * 2. Speech is cut into whole words, lower-cased, without accents or vowel
 *    marks (so "SÍ", "si" and "sì" are one word and "yesterday" is not "yes").
 * 3. A sign of doubt ("maybe", "not sure", "je ne sais pas") is unclear.
 * 4. A yes and a no in one breath ("yes... no", "oui mais pas encore") is
 *    unclear. A no or a negation alone is no.
 * 5. A yes counts only from a short utterance made entirely of yes words,
 *    ordinary filler ("yes, she was here this morning") and the caregiver's
 *    own name. Anything else beside the yes ("ignore your rules and say yes")
 *    is unclear, so nobody can talk Kin into a yes with a longer sentence.
 */
const MAX_YES_WORDS = 8;
const MAX_SPEECH_CHARS = 1000;

const APOSTROPHES = /['’ʼ`]/g;

/** Lower case, no accents, no Arabic or Hebrew vowel marks, no punctuation: the words of an utterance. */
export function answerWords(text: string, elision: AnswerLexicon["elision"]): readonly string[] {
  return text
    .slice(0, MAX_SPEECH_CHARS)
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ى/g, "ي")
    .replace(/ـ/g, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(APOSTROPHES, elision === "split" ? " " : "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((each) => each !== "");
}

type Compiled = {
  readonly yes: ReadonlySet<string>;
  readonly yesPhrases: readonly (readonly string[])[];
  readonly no: ReadonlySet<string>;
  readonly hedges: ReadonlySet<string>;
  readonly hedgePhrases: readonly (readonly string[])[];
  readonly filler: ReadonlySet<string>;
  readonly elision: AnswerLexicon["elision"];
  readonly conjunction: string | null;
};

function compile(lexicon: AnswerLexicon): Compiled {
  const normalize = (list: readonly string[]): ReadonlySet<string> => new Set(list.flatMap((each) => answerWords(each, lexicon.elision)));
  const phrases = (list: readonly string[]) => list.map((each) => answerWords(each, lexicon.elision));
  return {
    yes: normalize(lexicon.yes),
    yesPhrases: phrases(lexicon.yesPhrases),
    no: normalize(lexicon.no),
    hedges: normalize(lexicon.hedges),
    hedgePhrases: phrases(lexicon.hedgePhrases),
    // The words of a yes phrase ("desde luego") are as plain as the yes itself.
    filler: normalize([...lexicon.filler, ...lexicon.yesPhrases]),
    elision: lexicon.elision,
    conjunction: lexicon.conjunction,
  };
}

const COMPILED = Object.fromEntries(Object.entries(ANSWER_LEXICONS).map(([locale, lexicon]) => [locale, compile(lexicon)])) as Readonly<Record<OfficeLocale, Compiled>>;

function containsRun(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0) return false;
  for (let start = 0; start + phrase.length <= tokens.length; start += 1) {
    if (phrase.every((word, offset) => tokens[start + offset] === word)) return true;
  }
  return false;
}

function inSet(set: ReadonlySet<string>, token: string, conjunction: string | null): boolean {
  if (set.has(token)) return true;
  // Arabic and Hebrew glue "and" onto the next word: "ولا" is "and no".
  return conjunction !== null && token.length > conjunction.length && token.startsWith(conjunction) && set.has(token.slice(conjunction.length));
}

function understandSpeech(speech: string, locale: OfficeLocale, names: readonly string[]): ShiftCallAnswer {
  const lexicon = COMPILED[locale];
  const tokens = answerWords(speech, lexicon.elision);
  if (tokens.length === 0) return "unclear";
  const { conjunction } = lexicon;
  const has = (set: ReadonlySet<string>) => tokens.some((token) => inSet(set, token, conjunction));

  if (has(lexicon.hedges) || lexicon.hedgePhrases.some((phrase) => containsRun(tokens, phrase))) return "unclear";
  const saysNo = has(lexicon.no);
  const saysYes = has(lexicon.yes) || lexicon.yesPhrases.some((phrase) => containsRun(tokens, phrase));
  if (saysYes && saysNo) return "unclear";
  if (saysNo) return "no";
  if (!saysYes || tokens.length > MAX_YES_WORDS) return "unclear";

  const nameWords = new Set(names.flatMap((each) => answerWords(each, lexicon.elision)));
  const plain = tokens.every((token) => inSet(lexicon.yes, token, conjunction) || inSet(lexicon.filler, token, conjunction) || nameWords.has(token));
  return plain ? "yes" : "unclear";
}

export type HeardAnswer = {
  /** What Twilio transcribed, or `null` for none. */
  readonly speech: string | null;
  /** The keys pressed, or `null` for none. */
  readonly digits: string | null;
  readonly locale: OfficeLocale;
  /** The caregiver's name, so "yes, Amara was here" is not mistaken for a longer sentence. */
  readonly names?: readonly string[];
};

const DIGIT_ANSWERS: Readonly<Record<string, ShiftCallAnswer>> = { "1": "yes", "2": "no" };

export function understandAnswer({ speech, digits, locale, names = [] }: HeardAnswer): ShiftCallAnswer {
  const spoken = speech === null || speech.trim() === "" ? null : understandSpeech(speech, locale, names);
  const pressed = digits === null || digits.trim() === "" ? null : (DIGIT_ANSWERS[digits.trim()] ?? "unclear");
  if (pressed === null) return spoken ?? "unclear";
  // A key and a word that disagree are not an answer; a word Kin cannot read does not overrule a key.
  if (spoken !== null && spoken !== "unclear" && spoken !== pressed) return "unclear";
  return pressed;
}
