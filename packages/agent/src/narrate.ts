import { hasHiddenCharacters, spokenNumbers, spokenNumbersAreAllowed } from "@kin/domain";

import { numbersIn } from "./number-values.ts";
import { byClaude, reasonForFailure, type FallbackReason, type Provenance } from "./provenance.ts";
import type { StructuredModel } from "./structured-model.ts";

/** The words and numbers a sentence may use: all of them come from the record. */
export type NarrationFacts = {
  /** Every figure that may appear, already formatted for the listener: amounts, days, years. */
  readonly figures: readonly string[];
  /** What happened, in the record's own plain words, for the model to rephrase. */
  readonly statement: string;
  /** The listener's language, as an English name ("French"). */
  readonly language: string;
};

const MAX_WORDS_LENGTH = 400;

/**
 * The number guard (docs/architecture.md section 9.6): wording the model
 * wrote reaches a person only if every number in it is one the record
 * supplied, it is short, and it has no link. Anything else is refused.
 * Numbers are compared by value, so "86,40 $", "86.40" and Arabic-Indic
 * digits for the same amount agree, while "860.40" and a changed digit do not.
 * Numbers written in words ("sixty-four", "soixante-quatre", "vierundsechzig")
 * are valued the same way and held to the same rule, and words that cannot be
 * valued are refused.
 */
export function passesNumberGuard(words: string, facts: Pick<NarrationFacts, "figures"> & { readonly language?: string }): boolean {
  if (words.trim() === "" || words.length > MAX_WORDS_LENGTH || hasHiddenCharacters(words) || /https?:|www\.|@/iu.test(words)) return false;
  const figures = facts.figures.flatMap(numbersIn);
  // Two sets, so a number word inside a name never authorises a digit amount. A figure's digits authorise digits and
  // words alike; a number word inside a figure, such as a payee called "Seven Oaks", authorises only that word again.
  const digitValues = new Set(figures.flatMap((figure) => figure.values));
  const wordValues = new Set(facts.figures.flatMap((figure) => spokenNumbers(figure, facts.language)).flatMap((number) => number.readings));
  // A whole amount may be said without its zero cents: "1.000" for a record that holds "1.000,00".
  const written = new Set(figures.flatMap((figure) => [figure.written, figure.written.replace(/[.,]00$/u, "")]));
  // "64,000" is sixty-four thousand in English and sixty-four in French. A number with two readings passes only if
  // the record wrote it that way itself or every reading is one the record holds, so a guess is never the one accepted.
  const digitsAllowed = numbersIn(words).every((number) => number.values.every((value) => digitValues.has(value)) || (number.values.length > 1 && written.has(number.written)));
  return digitsAllowed && spokenNumbersAreAllowed(words, (value) => digitValues.has(value) || wordValues.has(value), facts.language);
}

const WORDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string" } },
} as const;

export const NARRATION_PROMPT_VERSION = "narration-2026-11-08";

export type Narration = { readonly text: string; readonly source: "model" | "template"; readonly provenance: Provenance };

/**
 * Words a result that plain code already decided. The model may phrase it
 * warmly; it may not add a number, so a wording that fails the guard, a
 * refusal, an outage or no model at all falls back to `template`, which
 * Kin fills from the record with fixed wording. The returned text is
 * therefore always safe to speak, and `provenance` says honestly whether the
 * model worded it or why it did not.
 */
export async function narrateWithProvenance(model: StructuredModel | null, facts: NarrationFacts, template: string): Promise<Narration> {
  const fallback = (reason: FallbackReason): Narration => ({ text: template, source: "template", provenance: { source: "template", reason } });
  if (model === null) return fallback("not_configured");
  try {
    const reply = await model({
      system: [
        `You put a result into one or two calm, plain sentences in ${facts.language}, spoken to an older person.`,
        "The statement is a fact Kin already decided. Say exactly what it says, do not add advice about money, and use only the figures and names it contains.",
        "Write every figure of the statement as digits, never in words: \"64\", not \"sixty-four\". Add no other number, not even an ordinal such as \"2nd\".",
      ].join("\n\n"),
      user: `<statement>\n${facts.statement.replaceAll(/<\/?statement\s*>/giu, "")}\n</statement>`,
      schema: WORDING_SCHEMA,
    });
    if (reply.kind === "refused") return fallback("model_refused");
    if (reply.kind !== "json") return fallback("unreadable");
    const { text } = JSON.parse(reply.text) as { text?: unknown };
    if (typeof text !== "string") return fallback("unreadable");
    if (!passesNumberGuard(text, facts)) return fallback("wording_rejected");
    return { text: text.trim(), source: "model", provenance: byClaude(model) };
  } catch (error) {
    return fallback(reasonForFailure(error));
  }
}

/** The same wording, without the provenance, for callers that only need the text and who made it. */
export async function narrate(model: StructuredModel | null, facts: NarrationFacts, template: string): Promise<{ readonly text: string; readonly source: "model" | "template" }> {
  const { text, source } = await narrateWithProvenance(model, facts, template);
  return { text, source };
}
