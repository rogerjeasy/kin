import { passesNumberGuard } from "./narrate.ts";
import { byClaude, reasonForFailure, type FallbackReason, type Provenance } from "./provenance.ts";
import type { StructuredModel } from "./structured-model.ts";

export const AUDITOR_PROMPT_VERSION = "auditor-2026-11-08";

export const SEVERITIES = ["info", "attention", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** One thing plain code found in an export, with the sentence Kin writes for it without a model. */
export type ReviewItem = {
  /** Unique within one review. The model refers to items by this and by nothing else. */
  readonly id: string;
  readonly severity: Severity;
  /** The entry the item is about, shown beside it; the model never rewrites it. */
  readonly entryId: string | null;
  /** Every figure the item may be worded with. */
  readonly figures: readonly string[];
  /** What happened, as a fixed sentence: the wording used whenever the model's is refused. */
  readonly template: string;
};

export type ReviewedItem = ReviewItem & { readonly text: string; readonly source: "model" | "template"; readonly provenance: Provenance };

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        properties: { id: { type: "string" }, text: { type: "string" } },
      },
    },
  },
} as const;

/**
 * The independent auditor. It shares nothing with the family agent: its own
 * instructions, no conversation history, and no tools. Plain code has already
 * decided every finding, its severity and its figures; the auditor only puts
 * each into a short plain sentence for a reader who was not there. Any
 * sentence whose numbers are not the finding's own, that names an unknown
 * finding, or that is missing, is replaced by the fixed template, so the
 * reviewed list always holds every finding exactly once and in the same order.
 * Each item says who worded it; `why` is the reason given when no model is
 * asked at all (none configured, not requested, or its use limit reached).
 */
export async function reviewFindings(model: StructuredModel | null, items: readonly ReviewItem[], language: string, why: FallbackReason = "not_configured"): Promise<ReviewedItem[]> {
  const fixed = (item: ReviewItem, reason: FallbackReason): ReviewedItem => ({ ...item, text: item.template, source: "template", provenance: { source: "template", reason } });
  const fallback = (reason: FallbackReason): ReviewedItem[] => items.map((item) => fixed(item, reason));
  if (model === null || items.length === 0) return fallback(why);
  try {
    const reply = await model({
      system: [
        `You are an independent auditor reading findings that deterministic checks produced about a family's shared money record. You did not take part in the family's conversations and you have no tools.`,
        `For each finding, write one calm, factual sentence in ${language} that a lawyer could read. Say only what the finding says. Use only the figures it lists, and write each as digits, never in words ("64", not "sixty-four"). Add no other number, not even an ordinal such as "2nd". Do not accuse anyone, speculate, advise on money or add facts.`,
        `Answer with every finding's id exactly as given.`,
      ].join("\n\n"),
      user: items.map((item) => `<finding id="${item.id}" severity="${item.severity}">\n${item.template.replaceAll(/<\/?finding[^>]*>/giu, "")}\n</finding>`).join("\n"),
      schema: REVIEW_SCHEMA,
    });
    if (reply.kind === "refused") return fallback("model_refused");
    if (reply.kind !== "json") return fallback("unreadable");
    const parsed = JSON.parse(reply.text) as { items?: unknown };
    const wording = new Map<string, string>();
    for (const each of Array.isArray(parsed.items) ? parsed.items : []) {
      if (typeof each === "object" && each !== null && "id" in each && "text" in each && typeof each.id === "string" && typeof each.text === "string") wording.set(each.id, each.text);
    }
    return items.map((item) => {
      const words = wording.get(item.id);
      if (words === undefined) return fixed(item, "unreadable");
      return passesNumberGuard(words, { ...item, language }) ? { ...item, text: words.trim(), source: "model", provenance: byClaude(model) } : fixed(item, "wording_rejected");
    });
  } catch (error) {
    return fallback(reasonForFailure(error));
  }
}
