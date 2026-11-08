import { byClaude, reasonForFailure, type FallbackReason, type Provenance } from "./provenance.ts";
import { guardShiftWording, type ShiftGuardSpec } from "./shift-guard.ts";
import { COVER_NOTE_TEMPLATES, QUESTION_TEMPLATES, fillSlots, type DayPart, type ShiftLanguage } from "./shift-templates.ts";
import {
  MAX_COVER_CANDIDATES,
  MAX_NOTE_CHARACTERS,
  MAX_QUESTION_CHARACTERS,
  MAX_TITLE_CHARACTERS,
  SHIFT_WORDING_SCHEMA,
  coverNoteSystem,
  factsMessage,
  questionSystem,
  type CoverNoteData,
  type QuestionData,
} from "./shift-words-prompt.ts";
import type { StructuredModel } from "./structured-model.ts";

/** Words from the model about care shifts, each with who made it. The text is always safe to show. */
export type ShiftWording = { readonly text: string; readonly source: "model" | "template"; readonly provenance: Provenance };

export type ShiftQuestionFacts = {
  readonly language: ShiftLanguage;
  /** The caregiver's first name, as the record has it. The model never sees it. */
  readonly caregiver: string;
  readonly part: DayPart;
  /** The time of check-out, already formatted for the reader. `null` when the caregiver has not checked out. */
  readonly checkedOutAt: string | null;
  /** What somebody typed as the shift's title. Untrusted: passed as data and never obeyed. */
  readonly title: string | null;
};

export type CoverNoteCandidate = {
  /** The member's first name. The model never sees it. */
  readonly name: string;
  readonly kind: "aide" | "visit";
  /** Hours already on the calendar that day and that week, formatted for the reader, such as "3 h 30 min". */
  readonly hoursThatDay: string;
  readonly hoursThisWeek: string;
};

export type CoverNoteFacts = {
  readonly language: ShiftLanguage;
  /** The cancelled shift's day and time, as the record writes them for the reader: "Thursday, 1:00 PM to 5:00 PM". */
  readonly when: string;
  readonly title: string | null;
  /** Ranked best first, by plain code. At most the first three are spoken of. */
  readonly candidates: readonly CoverNoteCandidate[];
};

const template = (text: string, source: "template", reason: FallbackReason): ShiftWording => ({ text, source, provenance: { source, reason } });
const title = (value: string | null): string | null => (value === null || value.trim() === "" ? null : value.trim().slice(0, MAX_TITLE_CHARACTERS));

async function modelText(model: StructuredModel, system: string, user: string): Promise<{ readonly text: string } | FallbackReason> {
  const reply = await model({ system, user, schema: SHIFT_WORDING_SCHEMA });
  if (reply.kind === "refused") return "model_refused";
  if (reply.kind !== "json") return "unreadable";
  const parsed: unknown = JSON.parse(reply.text);
  const text = typeof parsed === "object" && parsed !== null && "text" in parsed ? parsed.text : undefined;
  return typeof text === "string" ? { text } : "unreadable";
}

/**
 * The question shown to the parent, and read aloud, about a visit:
 * "Was Amara here this morning?". The model words it from the part of the day
 * and, if there is one, the time the caregiver left; it never sees the name.
 * Anything it writes that the guard refuses, a refusal, an outage or no model
 * at all gives Kin's fixed question, so the person always reads a sentence
 * Kin stands behind, and `provenance` says honestly which one it is.
 */
export async function wordShiftQuestion(model: StructuredModel | null, facts: ShiftQuestionFacts): Promise<ShiftWording> {
  const fixed = fillSlots(QUESTION_TEMPLATES[facts.language][facts.part], { name: facts.caregiver });
  if (model === null) return template(fixed, "template", "not_configured");
  const data: QuestionData = { part: facts.part, checkedOutAt: facts.checkedOutAt, title: title(facts.title) };
  const spec: ShiftGuardSpec = {
    language: facts.language,
    names: { name: facts.caregiver },
    required: ["name"],
    figures: facts.checkedOutAt === null ? [] : [facts.checkedOutAt],
    vocabulary: facts.checkedOutAt === null ? [] : [facts.checkedOutAt],
    maxCharacters: MAX_QUESTION_CHARACTERS,
  };
  return worded(model, questionSystem(facts.language), factsMessage(data), spec, fixed);
}

/**
 * The note beside the ranked cover candidates. The ranking is plain code's;
 * the model only explains it, in the viewer's language, from the hours the
 * record gives. It writes `{c1}`, `{c2}`, `{c3}` for the names and Kin puts
 * them in. A candidate who needs a paid aide shift or a care visit is said
 * so from the record's own `kind`, and no amount is ever offered to it.
 */
export async function wordCoverNote(model: StructuredModel | null, facts: CoverNoteFacts): Promise<ShiftWording | null> {
  const [best] = facts.candidates;
  if (best === undefined) return null;
  const fixed = fillSlots(COVER_NOTE_TEMPLATES[facts.language], { name: best.name, hours: best.hoursThisWeek });
  if (model === null) return template(fixed, "template", "not_configured");
  const spoken = facts.candidates.slice(0, MAX_COVER_CANDIDATES);
  const slotted = spoken.map((candidate, index) => ({ ...candidate, slot: `{c${index + 1}}` }));
  const data: CoverNoteData = {
    when: facts.when,
    title: title(facts.title),
    candidates: slotted.map(({ slot, kind, hoursThatDay, hoursThisWeek }) => ({ slot, kind, hoursThatDay, hoursThisWeek })),
  };
  const figures = spoken.flatMap((candidate) => [candidate.hoursThatDay, candidate.hoursThisWeek]);
  const spec: ShiftGuardSpec = {
    language: facts.language,
    names: Object.fromEntries(spoken.map((candidate, index) => [`c${index + 1}`, candidate.name])),
    required: ["c1"],
    figures: [facts.when, ...figures],
    vocabulary: [facts.when, ...figures],
    maxCharacters: MAX_NOTE_CHARACTERS,
  };
  return worded(model, coverNoteSystem(facts.language), factsMessage(data), spec, fixed);
}

async function worded(model: StructuredModel, system: string, user: string, spec: ShiftGuardSpec, fixed: string): Promise<ShiftWording> {
  try {
    const reply = await modelText(model, system, user);
    if (typeof reply === "string") return template(fixed, "template", reply);
    const text = guardShiftWording(reply.text, spec);
    return text === null ? template(fixed, "template", "wording_rejected") : { text, source: "model", provenance: byClaude(model) };
  } catch (error) {
    return template(fixed, "template", reasonForFailure(error));
  }
}
