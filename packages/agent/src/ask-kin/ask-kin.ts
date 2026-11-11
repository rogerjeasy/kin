import { answerPassesGuard, evidenceOf } from "./answer-guard.ts";
import { askKinQuestion, askKinSystem } from "./ask-kin-prompt.ts";
import type { RoutedCall } from "./route-question.ts";
import type { GatewayCall, JsonValue, RaisedProposal, ToolGateway, ToolOutcome } from "./tool-gateway.ts";
import type { ToolMessage, ToolModel, ToolResultBlock, ToolTurn } from "./tool-model.ts";

/**
 * Ask Kin: an agent-led loop with deterministic boundaries
 * (docs/architecture.md section 9.3). The model chooses which tools to call
 * and words the answer. Plain code decides everything else: which tools the
 * person's role is offered, whether each call may run, how many turns and
 * calls a question may take, and whether the answer's figures all come from
 * what the tools returned. An answer that fails the number guard, a refusal,
 * a cut-off or a loop that runs out of turns is replaced by fixed wording
 * built from the tools' own findings. A question has a deadline: when Claude
 * cannot be reached, or does not answer in time, before any tool has run, Kin
 * routes the question to its tools with plain code, through the same gateway,
 * and answers with its fixed wording.
 */

export const MAX_QUESTION_LENGTH = 500;
export const MAX_HISTORY_TURNS = 6;
/** Model requests per question. With the gateway's call limit, no question can loop for long. */
export const MAX_MODEL_TURNS = 6;
/**
 * The longest a question may take, model turns and tool calls together. A
 * multi-step answer takes well under it; App Runner ends a request at 120
 * seconds, and a throttled model with the SDK's retries could take minutes.
 */
export const QUESTION_DEADLINE_MS = 45_000;

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
  /** Kin's own routing of the question to its tools, used only when Claude cannot answer before any tool ran. */
  readonly route?: (question: string) => readonly RoutedCall[];
  /** The question's deadline, in milliseconds. */
  readonly deadlineMs?: number;
};

/** One tool call as the person sees it. `raised` says whether a proposing tool actually raised a proposal. */
export type AskKinCall = { readonly tool: string; readonly outcome: ToolOutcome; readonly raised: boolean };

/**
 * Why the answer is the fixed wording rather than the model's. `no_claude`:
 * Claude could not be reached, or did not answer in time, before any tool
 * ran, so Kin chose the tools itself.
 */
export type TemplateReason = "refused" | "cut_off" | "turns" | "guard" | "unavailable" | "no_claude";

export type AskKinResult =
  | {
      readonly kind: "answered";
      readonly text: string;
      readonly source: "claude" | "template";
      readonly templateReason: TemplateReason | null;
      readonly calls: readonly AskKinCall[];
      /** A proposal raised while answering. It waits for the family's yes. */
      readonly proposal: RaisedProposal | null;
    }
  /** The model could not be reached before any tool ran, and Kin's own routing found no tool for the question. A retry may help. */
  | { readonly kind: "unavailable" };

function historyMessages(history: readonly AskKinTurn[]): ToolMessage[] {
  return history.slice(-MAX_HISTORY_TURNS).flatMap((turn): ToolMessage[] => [
    { role: "user", content: askKinQuestion(turn.question) },
    { role: "assistant", content: turn.answer },
  ]);
}

class DeadlinePassed extends Error {}

/** Rejects once `signal` aborts, so a model that never answers cannot hold the question. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new DeadlinePassed());
    signal.addEventListener("abort", () => reject(new DeadlinePassed()), { once: true });
  });
}

/** What the tools found while answering one question. */
type Findings = { readonly calls: AskKinCall[]; readonly facts: string[]; readonly results: JsonValue[]; proposal: RaisedProposal | null };

function keep(findings: Findings, done: GatewayCall): void {
  findings.calls.push({ tool: done.record.tool, outcome: done.record.outcome, raised: done.output?.proposal !== undefined });
  if (done.output === null) return;
  findings.facts.push(done.output.fact);
  findings.results.push(done.output.data);
  findings.proposal = done.output.proposal ?? findings.proposal;
}

/**
 * Claude could not answer before any tool ran: Kin's own routing picks the
 * tools, the gateway checks and runs them as it would the model's, and the
 * answer is the fixed wording from what they found. A question the routing
 * does not recognise stays unanswered; a retry may then help.
 */
async function answerWithoutClaude(request: AskKinRequest, findings: Findings): Promise<AskKinResult> {
  const routed = request.route?.(request.question) ?? [];
  if (routed.length === 0) return { kind: "unavailable" };
  for (const [index, call] of routed.entries()) keep(findings, await request.gateway.call({ id: `kin_route_${index + 1}`, name: call.name, input: call.input }));
  return { kind: "answered", text: request.template(findings.facts), source: "template", templateReason: "no_claude", calls: findings.calls, proposal: findings.proposal };
}

export async function askKin(model: ToolModel, request: AskKinRequest): Promise<AskKinResult> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), request.deadlineMs ?? QUESTION_DEADLINE_MS);
  try {
    return await answer(model, request, deadline.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function answer(model: ToolModel, request: AskKinRequest, signal: AbortSignal): Promise<AskKinResult> {
  const { gateway } = request;
  const messages: ToolMessage[] = [...historyMessages(request.history), { role: "user", content: askKinQuestion(request.question) }];
  const findings: Findings = { calls: [], facts: [], results: [], proposal: null };
  const fallback = (templateReason: TemplateReason): AskKinResult => ({ kind: "answered", text: request.template(findings.facts), source: "template", templateReason, calls: findings.calls, proposal: findings.proposal });
  // Whatever the tools already found, and any proposal already raised, is still the person's to see.
  const cannotAnswer = () => (findings.calls.length === 0 ? answerWithoutClaude(request, findings) : fallback("unavailable"));

  for (let turn = 0; turn < MAX_MODEL_TURNS; turn += 1) {
    let reply: ToolTurn;
    try {
      reply = await Promise.race([model({ system: askKinSystem(request.language), messages, tools: gateway.tools, signal }), untilAborted(signal)]);
    } catch {
      return cannotAnswer();
    }
    if (reply.stopReason === "refusal") return fallback("refused");
    if (reply.stopReason === "max_tokens") return fallback("cut_off");
    messages.push({ role: "assistant", content: reply.content });
    if (reply.stopReason === "pause_turn") continue;
    if (reply.stopReason !== "tool_use" || reply.toolUses.length === 0) {
      if (!answerPassesGuard(reply.text, evidenceOf(findings.results), request.language)) return fallback("guard");
      return { kind: "answered", text: reply.text.trim(), source: "claude", templateReason: null, calls: findings.calls, proposal: findings.proposal };
    }
    const results: ToolResultBlock[] = [];
    // One at a time, in the model's order, so the record of calls reads in the order they ran. A call already running is
    // never abandoned, since it may have raised a proposal; once the deadline has passed, no further call starts.
    for (const use of reply.toolUses) {
      if (signal.aborted) return cannotAnswer();
      const done = await gateway.call(use);
      keep(findings, done);
      results.push(done.block);
    }
    messages.push({ role: "user", content: results });
  }
  return fallback("turns");
}
