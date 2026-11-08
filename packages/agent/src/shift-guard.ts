import { passesNumberGuard } from "./narrate.ts";
import { fillSlots, type ShiftLanguage } from "./shift-templates.ts";
import { ALWAYS_ALLOWED, OPENERS } from "./shift-vocabulary.ts";

/**
 * The guard for wording about care shifts (docs/architecture.md section 9.6).
 * The model never sees a person's name: it writes `{name}` and Kin puts the
 * name in, so a name always arrives exactly as the record has it. Then the
 * filled sentence must hold no number the record did not supply, no capitalised
 * word that is not a name or a word the record supplied, no link and nothing
 * over-long. Anything else is refused and the fixed wording stands.
 */

export type ShiftGuardSpec = {
  readonly language: ShiftLanguage;
  /** Slot to name: the only names the sentence may hold. Every one listed in `required` must be used. */
  readonly names: Readonly<Record<string, string>>;
  readonly required: readonly string[];
  /** Every figure the sentence may hold, as the record writes it: a time, a duration. */
  readonly figures: readonly string[];
  /** Strings whose words the record supplied (a weekday, a time range), so they may be written, capitalised or not. */
  readonly vocabulary: readonly string[];
  readonly maxCharacters: number;
};

/** What passed: the sentence with the names put in. Anything else is `null`. */
export type GuardedWording = string | null;

const WORD = /[\p{L}\p{M}]+/gu;
const SENTENCE_END = /[.!?…؟¿¡:;]$/u;
const OPENING_MARKS = /[\s"'“”«»‘’([]+$/u;
const SLOT = /\{(\w+)\}/gu;

const wordsOf = (text: string): string[] => text.match(WORD) ?? [];

/**
 * Puts the names in and checks the sentence. `null` when it is empty, too long, on several lines, holds a link or a
 * hidden character, uses a slot it was not given or leaves a required one out, writes a number the record did not
 * supply (in digits or in words), or writes a capitalised word that is neither a name nor a word the record supplied.
 * Where a language has no capital letters (Arabic, Hebrew) an invented name in that script cannot be told from any
 * other word, so only the other checks apply there.
 */
export function guardShiftWording(text: string, spec: ShiftGuardSpec): GuardedWording {
  const trimmed = text.trim();
  if (trimmed === "" || /[\r\n]/u.test(trimmed)) return null;
  const slots = [...trimmed.matchAll(SLOT)].map((match) => match[1] ?? "");
  if (slots.some((slot) => !Object.hasOwn(spec.names, slot)) || spec.required.some((slot) => !slots.includes(slot))) return null;
  const filled = fillSlots(trimmed, spec.names);
  if (/[{}]/u.test(filled) || filled.length > spec.maxCharacters) return null;
  if (!passesNumberGuard(filled, { figures: spec.figures, language: spec.language })) return null;
  return capitalisedWordsAreKnown(filled, spec) ? filled : null;
}

function capitalisedWordsAreKnown(filled: string, spec: ShiftGuardSpec): boolean {
  const allowed = new Set([...Object.values(spec.names), ...spec.vocabulary, ...ALWAYS_ALLOWED[spec.language]].flatMap(wordsOf));
  const openers = new Set(OPENERS[spec.language]);
  for (const match of filled.matchAll(WORD)) {
    const word = match[0];
    if (!/^\p{Lu}/u.test(word) || allowed.has(word)) continue;
    const before = filled.slice(0, match.index).replace(OPENING_MARKS, "");
    const opens = before === "" || SENTENCE_END.test(before);
    if (!(opens && openers.has(word.toLowerCase()))) return false;
  }
  return true;
}
