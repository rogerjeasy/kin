import { passesNumberGuard } from "../narrate.ts";
import { askKinQuestion, askKinSystem } from "./ask-kin-prompt.ts";
import type { JsonValue, RaisedProposal, ToolGateway, ToolOutcome } from "./tool-gateway.ts";
import type { ToolMessage, ToolModel, ToolResultBlock } from "./tool-model.ts";

/**
 * Ask Kin: an agent-led loop with deterministic boundaries
 * (docs/architecture.md section 9.3). The model chooses which tools to call
 * and words the answer. Plain code decides everything else: which tools the
 * person's role is offered, whether each call may run, how many turns and
 * calls a question may take, and whether the answer's figures all come from
 * what the tools returned. An answer that fails the number guard, a refusal,
 * a cut-off or a loop that runs out of turns is replaced by fixed wording
 * built from the tools' own findings.
 */

export const MAX_QUESTION_LENGTH = 500;
export const MAX_HISTORY_TURNS = 6;
/** Model requests per question. With the gateway's call limit, no question can loop for long. */
export const MAX_MODEL_TURNS = 6;
/** The longest answer accepted at all; each sentence also meets the narration guard's own limit. */
const MAX_ANSWER_LENGTH = 800;

export type AskKinTurn = { readonly question: string; readonly answer: string };

export type AskKinRequest = {
  readonly question: string;
  /** The last few questions and the answers Kin showed, held by the browser. */
  readonly history: readonly AskKinTurn[];
  /** The listener's language, as an English name ("French"). */
  readonly language: string;
  readonly gateway: ToolGateway;
  /** Fixed wording from the tools' findings, in the listener's language, used whenever the model's own cannot be. */
  readonly template: (facts: readonly string[]) => string;
};

/** One tool call as the person sees it. `raised` says whether a proposing tool actually raised a proposal. */
export type AskKinCall = { readonly tool: string; readonly outcome: ToolOutcome; readonly raised: boolean };

/** Why the answer is the fixed wording rather than the model's. */
export type TemplateReason = "refused" | "cut_off" | "turns" | "guard" | "unavailable";

export type AskKinResult =
  | {
      readonly kind: "answered";
      readonly text: string;
      readonly source: "claude" | "template";
      readonly templateReason: TemplateReason | null;
      readonly calls: readonly AskKinCall[];
      /** A proposal raised while answering: waiting for a yes, or approved at once by the parent's standing permission. */
      readonly proposal: RaisedProposal | null;
    }
  /** The model could not be reached before any tool ran. A retry may help. */
  | { readonly kind: "unavailable" };

/** Every text and number a tool handed back: the figures an answer may use. */
export function figuresOf(value: JsonValue): string[] {
  if (value === null || typeof value === "boolean") return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(figuresOf);
  return Object.values(value).flatMap(figuresOf);
}

/**
 * Whether every number in the answer is one the tools returned. The guard
 * reads at most a few sentences at a time, so a longer answer is read one
 * sentence at a time, and every sentence must pass.
 */
export function answerPassesGuard(text: string, figures: readonly string[], language: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > MAX_ANSWER_LENGTH) return false;
  const sentences = trimmed.split(/(?<=[.!?。؟])\s+/u).filter((sentence) => sentence !== "");
  return sentences.every((sentence) => passesNumberGuard(sentence, { figures, language }));
}

function historyMessages(history: readonly AskKinTurn[]): ToolMessage[] {
  return history.slice(-MAX_HISTORY_TURNS).flatMap((turn): ToolMessage[] => [
    { role: "user", content: askKinQuestion(turn.question) },
    { role: "assistant", content: turn.answer },
  ]);
}

export async function askKin(model: ToolModel, request: AskKinRequest): Promise<AskKinResult> {
  const { gateway } = request;
  const messages: ToolMessage[] = [...historyMessages(request.history), { role: "user", content: askKinQuestion(request.question) }];
  const calls: AskKinCall[] = [];
  const facts: string[] = [];
  const figures: string[] = [];
  let proposal: RaisedProposal | null = null;

  const fallback = (templateReason: TemplateReason): AskKinResult => ({ kind: "answered", text: request.template(facts), source: "template", templateReason, calls, proposal });

  for (let turn = 0; turn < MAX_MODEL_TURNS; turn += 1) {
    let reply;
    try {
      reply = await model({ system: askKinSystem(request.language), messages, tools: gateway.tools });
    } catch {
      // Whatever the tools already found, and any proposal already raised, is still the person's to see.
      return calls.length === 0 ? { kind: "unavailable" } : fallback("unavailable");
    }
    if (reply.stopReason === "refusal") return fallback("refused");
    if (reply.stopReason === "max_tokens") return fallback("cut_off");
    messages.push({ role: "assistant", content: reply.content });
    if (reply.stopReason === "pause_turn") continue;
    if (reply.stopReason !== "tool_use" || reply.toolUses.length === 0) {
      if (!answerPassesGuard(reply.text, figures, request.language)) return fallback("guard");
      return { kind: "answered", text: reply.text.trim(), source: "claude", templateReason: null, calls, proposal };
    }
    const results: ToolResultBlock[] = [];
    // One at a time, in the model's order, so the record of calls reads in the order they ran.
    for (const use of reply.toolUses) {
      const done = await gateway.call(use);
      calls.push({ tool: done.record.tool, outcome: done.record.outcome, raised: done.output?.proposal !== undefined });
      results.push(done.block);
      if (done.output !== null) {
        facts.push(done.output.fact);
        figures.push(...figuresOf(done.output.data));
        proposal = done.output.proposal ?? proposal;
      }
    }
    messages.push({ role: "user", content: results });
  }
  return fallback("turns");
}
