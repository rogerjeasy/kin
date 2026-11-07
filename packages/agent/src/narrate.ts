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
const NUMBER = /\d[\d.,\p{Zs}]*\d|\d/gu;
const digitsOf = (text: string) => text.replace(/\D/gu, "");

/**
 * The number guard (docs/architecture.md section 9.6): wording the model
 * wrote reaches a person only if every number in it is one the record
 * supplied, it is short, and it has no link. Anything else is refused.
 */
export function passesNumberGuard(words: string, facts: Pick<NarrationFacts, "figures">): boolean {
  if (words.trim() === "" || words.length > MAX_WORDS_LENGTH || /https?:|www\.|@/iu.test(words)) return false;
  const allowed = new Set(facts.figures.flatMap((figure) => [...figure.matchAll(NUMBER)].map((match) => digitsOf(match[0]))));
  return [...words.matchAll(NUMBER)].every((match) => allowed.has(digitsOf(match[0])));
}

const WORDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string" } },
} as const;

export const NARRATION_PROMPT_VERSION = "narration-2026-11-07";

/**
 * Words a result that plain code already decided. The model may phrase it
 * warmly; it may not add a number, so a wording that fails the guard, a
 * refusal, an outage or no model at all falls back to `template`, which
 * Kin fills from the record with fixed wording. The returned text is
 * therefore always safe to speak.
 */
export async function narrate(model: StructuredModel | null, facts: NarrationFacts, template: string): Promise<{ readonly text: string; readonly source: "model" | "template" }> {
  const fallback = { text: template, source: "template" } as const;
  if (model === null) return fallback;
  try {
    const reply = await model({
      system: [
        `You put a result into one or two calm, plain sentences in ${facts.language}, spoken to an older person.`,
        "The statement is a fact Kin already decided. Say exactly what it says, do not add advice about money, and use only the figures and names it contains.",
      ].join("\n\n"),
      user: `<statement>\n${facts.statement.replaceAll(/<\/?statement\s*>/giu, "")}\n</statement>`,
      schema: WORDING_SCHEMA,
    });
    if (reply.kind !== "json") return fallback;
    const { text } = JSON.parse(reply.text) as { text?: unknown };
    if (typeof text !== "string" || !passesNumberGuard(text, facts)) return fallback;
    return { text: text.trim(), source: "model" };
  } catch {
    return fallback;
  }
}
