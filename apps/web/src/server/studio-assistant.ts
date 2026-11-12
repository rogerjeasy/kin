import { KIN_RECORD_TOOL, studioAssistantSystem, studioAssistantTurn, studioNotes, type AssistantFallback, type ShiftLanguage } from "@kin/agent";
import { authorize } from "@kin/auth";
import type { CircleRole } from "@kin/domain";

import { getDictionary } from "@/i18n/dictionary";
import { defaultLocale, isLocale } from "@/i18n/locales";

import { createRateLimiter, spendUse } from "./model";
import type { AssistantContext, AssistantResponse } from "./shift-assistant";
import { parseAssistantInputWith, type AssistantInputPolicy } from "./shift-assistant-input";

/**
 * The route the family money studio's agents send each turn to. AG Studio's
 * Agent Framework runs the loop in the browser and executes its tools there,
 * against the dashboard of the record the viewer may already see; this is the
 * one place that talks to the model. It checks who is asking, keeps only the
 * dashboard's own tools (and, for an observer, only those that read), puts
 * Kin's instructions first, limits the calls, checks the answer's figures
 * against what the tools returned, and answers in the widget's shape.
 */

/** The same limits as the calendar assistant: sixty requests an hour a person, four hundred a server for demo visitors and as many for people. */
export const studioLimiter = createRateLimiter(60, 60 * 60_000);
export const studioBudget = createRateLimiter(400, 60 * 60_000);

/** AG Studio's tools that only read the dashboard or its data, and Kin's own, which reads the record's figures the page already holds. */
export const STUDIO_READ_TOOLS: ReadonlySet<string> = new Set(["view_schema", "view_report", "view_page", "view_widget", "view_plan", "execute_query", "rename_thread", "delegate_to", "complete_task", KIN_RECORD_TOOL]);

/** AG Studio's tools that change what the dashboard on the viewer's screen shows. Nothing they do leaves the page. */
export const STUDIO_LAYOUT_TOOLS: ReadonlySet<string> = new Set([
  "add_widget",
  "position_widget",
  "remove_widget",
  "configure_widget",
  "add_page_filter",
  "remove_page_filter",
  "add_widget_filter",
  "remove_widget_filter",
  "create_plan",
  "update_plan",
  "clear_plan",
  "create_expression",
  "update_expression",
  "delete_expression",
]);

export const MAX_STUDIO_BYTES = 786_432;

const LIMITS = {
  maxText: 20_000,
  // AG Studio's instructions carry its schema and its guidance on widgets.
  maxSystemText: 120_000,
  maxResult: 60_000,
  maxMessages: 120,
  maxBlocks: 30,
  maxTools: 40,
  maxSystemParts: 8,
  maxSchemaJson: 80_000,
  maxDescription: 8_000,
} as const;

/** Who may change their own view of the dashboard, and who may only read it. */
export function studioPolicy(role: CircleRole): AssistantInputPolicy {
  const layout = role !== "observer";
  return { ...LIMITS, allowed: layout ? new Set([...STUDIO_READ_TOOLS, ...STUDIO_LAYOUT_TOOLS]) : STUDIO_READ_TOOLS, dropped: layout ? new Set() : STUDIO_LAYOUT_TOOLS };
}

type Words = "unavailable" | "cannot" | "limit" | "unchecked";
const WORDS: Readonly<Record<AssistantFallback, Words>> = { refused: "cannot", cut_off: "cannot", unchecked: "unchecked", too_many_rounds: "cannot", unusable: "cannot", unavailable: "unavailable" };

async function said(locale: ShiftLanguage, words: Words): Promise<AssistantResponse> {
  const copy = (await getDictionary(locale)).dashboard.studio.assistant;
  return { ok: true, type: "message", role: "assistant", content: [{ type: "text", text: copy[words] }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
}

/**
 * One turn of one of the studio's agents. Anyone seated in the circle who may
 * see its money may ask, which leaves a caregiver out as the Record does. Each
 * request spends one use of the person's and the server's limits before the
 * model is called, and a refusal costs nothing.
 */
export async function runStudioAssistant(context: AssistantContext, input: unknown): Promise<AssistantResponse> {
  const { circle } = context;
  const role = circle.viewer.role;
  if (!authorize({ role, status: "active" }, "money.view").allowed) return { ok: false, reason: "refused" };
  const parsed = parseAssistantInputWith(studioPolicy(role), input);
  if (parsed === null) return { ok: false, reason: "invalid" };
  const locale: ShiftLanguage = context.locale !== null && isLocale(context.locale) ? context.locale : defaultLocale;
  if (context.model === null) return said(locale, "unavailable");
  if (!spendUse({ limiter: context.limiter, budget: context.budget }, { userId: context.userId, accountTypes: context.accountTypes }, context.now?.() ?? Date.now())) return said(locale, "limit");
  const system = [studioAssistantSystem(role, locale), ...(parsed.notes.length === 0 ? [] : [studioNotes(parsed.notes)])].join("\n\n");
  const reply = await studioAssistantTurn(context.model, { system, messages: parsed.messages, tools: parsed.tools }, locale);
  if (reply.kind === "fallback") return said(locale, WORDS[reply.reason]);
  return { ok: true, type: "message", role: "assistant", content: reply.blocks, stop_reason: reply.stopReason, usage: { input_tokens: reply.usage.inputTokens, output_tokens: reply.usage.outputTokens } };
}
