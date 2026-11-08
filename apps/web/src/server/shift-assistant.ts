import { assistantSystem, bedrockAssistantModel, shiftAssistantTurn, widgetNotes, type AssistantBlock, type AssistantFallback, type AssistantModel, type ShiftLanguage } from "@kin/agent";
import { authorize, type BillingAccount } from "@kin/auth";
import type { CircleSnapshot } from "@kin/db";
import { readModelConfig } from "@kin/config";

import { getDictionary } from "@/i18n/dictionary";
import { defaultLocale, isLocale } from "@/i18n/locales";

import { createRateLimiter, spendUse, type RateLimiter } from "./model";
import { parseAssistantInput } from "./shift-assistant-input";

/**
 * The route the calendar's experimental assistant sends its prompts to
 * (docs/architecture.md decision 82). The widget in the browser speaks an
 * Anthropic-style Messages protocol and runs the tools that read or filter
 * the calendar it holds, which is only what the viewer can already see. This
 * is the one place that talks to the model: it checks who is asking, keeps
 * only the tools that cannot change anything, fixes the instructions, limits
 * the calls, checks the answer's figures against what the tools returned, and
 * answers in the widget's own shape. The model never books, moves or pays.
 */

/** Each person may send sixty requests an hour (a question takes a few); each server 400 for demo visitors and 400 for people. */
export const assistantLimiter = createRateLimiter(60, 60 * 60_000);
export const assistantBudget = createRateLimiter(400, 60 * 60_000);

let assistant: AssistantModel | null | undefined;

/** Claude with the widget's tools, or `null` when this deployment has no model. Read on first use, never at build time. */
export function assistantModel(): AssistantModel | null {
  if (assistant === undefined) {
    const config = readModelConfig(process.env);
    assistant = config.enabled ? bedrockAssistantModel(config) : null;
  }
  return assistant;
}

export type AssistantContext = {
  readonly circle: CircleSnapshot;
  readonly userId: string;
  readonly accountTypes: BillingAccount;
  /** The language the widget says it is in, from its own header; anything but one of ours is English. */
  readonly locale: string | null;
  /** Claude with the widget's tools, or `null` when this deployment has no model. */
  readonly model: AssistantModel | null;
  readonly limiter?: RateLimiter;
  readonly budget?: RateLimiter;
  readonly now?: () => number;
};

/** What the widget reads: a Messages response with the model's text and tool calls. `ok` and the widget's other keys are ignored by it. */
export type AssistantResponse =
  | {
      readonly ok: true;
      readonly type: "message";
      readonly role: "assistant";
      readonly content: readonly AssistantBlock[];
      readonly stop_reason: "end_turn" | "tool_use";
      readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
    }
  | { readonly ok: false; readonly reason: "refused" | "invalid" };

type Words = "unavailable" | "cannot" | "limit";
const WORDS: Readonly<Record<AssistantFallback, Words>> = { refused: "cannot", cut_off: "cannot", unchecked: "cannot", too_many_rounds: "cannot", unusable: "cannot", unavailable: "unavailable" };

/** A plain sentence in the widget's own shape, for when there is nothing the model may say. */
async function said(locale: ShiftLanguage, words: Words): Promise<AssistantResponse> {
  const copy = (await getDictionary(locale)).dashboard.shiftAssistant;
  return { ok: true, type: "message", role: "assistant", content: [{ type: "text", text: copy[words] }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
}

/**
 * One request from the calendar widget. Anyone seated in the circle who may
 * see the calendar may ask; what they are told rests on the calendar the
 * widget holds, which for a caregiver is their own shifts alone. Each request
 * spends one use of the person's and the server's limits before the model is
 * called, and a refusal costs nothing.
 */
export async function runShiftAssistant(context: AssistantContext, input: unknown): Promise<AssistantResponse> {
  const { circle } = context;
  if (!authorize({ role: circle.viewer.role, status: "active" }, "shift.view").allowed) return { ok: false, reason: "refused" };
  const parsed = parseAssistantInput(input);
  if (parsed === null) return { ok: false, reason: "invalid" };
  const locale: ShiftLanguage = context.locale !== null && isLocale(context.locale) ? context.locale : defaultLocale;
  if (context.model === null) return said(locale, "unavailable");
  if (!spendUse({ limiter: context.limiter, budget: context.budget }, { userId: context.userId, accountTypes: context.accountTypes }, context.now?.() ?? Date.now())) return said(locale, "limit");
  const system = [assistantSystem(circle.viewer.role, locale), ...(parsed.notes.length === 0 ? [] : [widgetNotes(parsed.notes)])].join("\n\n");
  const reply = await shiftAssistantTurn(context.model, { system, messages: parsed.messages, tools: parsed.tools }, locale);
  if (reply.kind === "fallback") return said(locale, WORDS[reply.reason]);
  return { ok: true, type: "message", role: "assistant", content: reply.blocks, stop_reason: reply.stopReason, usage: { input_tokens: reply.usage.inputTokens, output_tokens: reply.usage.outputTokens } };
}
