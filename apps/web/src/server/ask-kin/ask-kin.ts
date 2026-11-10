import { MAX_HISTORY_TURNS, MAX_QUESTION_LENGTH, askKin, toolGateway, type AskKinTurn, type ToolModel, type ToolOutcome, type ToolRecorder } from "@kin/agent";
import { authorize, type BillingAccount } from "@kin/auth";
import { asPerson, readExecutions, type CircleSnapshot, type Database } from "@kin/db";

import { LANGUAGE_NAMES } from "@/components/dashboard/words/letter-words";
import { dashboardRoutes, purseRoute } from "@/content/dashboard-routes";
import { getDictionary, type Dictionary } from "@/i18n/dictionary";
import { isLocale, type Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";

import { spendUse, type Allowance, type RateLimiter } from "../model";
import { questionsLeft } from "./demo-questions";
import { askKinTools, logToolCall } from "./tools";
import { askKinWorld, type PayPalReader } from "./world";

export type AskKinContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
  readonly accountTypes: BillingAccount;
  /** Claude with tools, or `null` when this deployment has no model. */
  readonly model: ToolModel | null;
  readonly paypal: PayPalReader | null;
  readonly limiter?: RateLimiter;
  readonly budget?: RateLimiter;
  /** The questions this person may still ask, when they are counted: a demo visitor who has not signed in. */
  readonly questions?: Allowance;
  readonly recorder?: ToolRecorder;
  readonly now?: () => number;
};

export type AskKinStep = { readonly tool: string; readonly label: string; readonly outcome: ToolOutcome; readonly outcomeLabel: string };

export type AskKinResponse =
  | {
      readonly ok: true;
      readonly answer: string;
      readonly source: "claude" | "template";
      /** The model that chose the tools, even when its wording was replaced. */
      readonly model: string;
      readonly steps: readonly AskKinStep[];
      readonly proposal: { readonly id: string; readonly href: string; readonly kind: "proposal" | "purse_payment" } | null;
      /** Questions left after this one, or `null` when this person's questions are not counted. */
      readonly questionsLeft: number | null;
    }
  | { readonly ok: false; readonly reason: "refused" | "invalid" | "busy" | "unavailable" | "demo_limit" };

/** An answer from an earlier turn, as the browser sends it back. Longer ones were never shown. */
const MAX_ANSWER_LENGTH = 1_000;

type AskKinInput = { readonly question: string; readonly locale: Locale; readonly history: readonly AskKinTurn[] };

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim() !== "" && value.length <= max;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (row: Record<string, unknown>, allowed: readonly string[]) => Object.keys(row).every((key) => allowed.includes(key));

/** The question, its language and up to six earlier turns, or `null` for anything else. */
export function parseAskKin(input: unknown): AskKinInput | null {
  if (!isRecord(input) || !onlyKeys(input, ["question", "locale", "history"])) return null;
  const { question, locale, history = [] } = input;
  if (!isText(question, MAX_QUESTION_LENGTH) || typeof locale !== "string" || !isLocale(locale)) return null;
  if (!Array.isArray(history) || history.length > MAX_HISTORY_TURNS) return null;
  const turns: AskKinTurn[] = [];
  for (const turn of history) {
    if (!isRecord(turn) || !onlyKeys(turn, ["question", "answer"]) || !isText(turn.question, MAX_QUESTION_LENGTH) || !isText(turn.answer, MAX_ANSWER_LENGTH)) return null;
    turns.push({ question: turn.question, answer: turn.answer });
  }
  return { question: question.trim(), locale, history: turns };
}

function steps(copy: Dictionary["askKin"], calls: readonly { readonly tool: string; readonly outcome: ToolOutcome }[]): AskKinStep[] {
  const labels: Readonly<Record<string, string>> = copy.tools;
  return calls.map((call) => ({ tool: call.tool, label: labels[call.tool] ?? copy.tools.unknown, outcome: call.outcome, outcomeLabel: copy.outcomes[call.outcome] }));
}

/**
 * The one request boundary for Ask Kin. Anyone seated in the circle may ask;
 * the tools their role may use are the only ones the model is offered. The
 * server keeps no conversation: the browser sends back the last few turns.
 * Each question spends one use of the person's and the server's model
 * limits, before the model is called. A demo visitor who has not signed in
 * has a fixed number of questions for their demo session as well.
 */
export async function runAskKin(context: AskKinContext, input: unknown): Promise<AskKinResponse> {
  const { circle } = context;
  if (!authorize({ role: circle.viewer.role, status: "active" }, "circle.view").allowed) return { ok: false, reason: "refused" };
  const parsed = parseAskKin(input);
  if (parsed === null) return { ok: false, reason: "invalid" };
  if (context.model === null) return { ok: false, reason: "unavailable" };
  const now = context.now ?? Date.now;
  if (context.questions !== undefined && !context.questions.allows(context.userId, now())) return { ok: false, reason: "demo_limit" };
  const limits = { limiter: context.limiter, budget: context.budget, allowance: context.questions };
  if (!spendUse(limits, { userId: context.userId, accountTypes: context.accountTypes }, now())) return { ok: false, reason: "busy" };

  const dictionary = await getDictionary(parsed.locale);
  const copy = dictionary.askKin;
  const world = askKinWorld({
    circle,
    locale: parsed.locale,
    dictionary,
    db: context.db,
    userId: context.userId,
    // Simulated money is labelled without a call; a real sandbox payment, even in a demo circle, is read from PayPal.
    paypal: context.paypal,
    executions: () => asPerson(context.db, context.userId, (tx) => readExecutions(tx, circle.circle.id)),
  });
  const gateway = toolGateway({
    context: { circleId: circle.circle.id, memberId: circle.viewer.memberId, role: circle.viewer.role, question: parsed.question },
    implementations: askKinTools(world),
    recorder: context.recorder ?? logToolCall,
    clock: now,
  });
  const result = await askKin(context.model, {
    question: parsed.question,
    history: parsed.history,
    language: LANGUAGE_NAMES[parsed.locale],
    gateway,
    template: (facts) => (facts.length === 0 ? copy.fallback.none : fill(copy.fallback.lead, { facts: facts.join(" ") })),
  });
  if (result.kind === "unavailable") return { ok: false, reason: "unavailable" };
  return {
    ok: true,
    answer: result.text,
    source: result.source,
    model: context.model.label,
    steps: steps(copy, result.calls),
    // A payment from her Purse waits for her own yes on her Purse screen; anything else for the family's on Approvals.
    proposal:
      result.proposal === null
        ? null
        : result.proposal.kind === "purse_payment"
          ? { id: result.proposal.id, href: localizedPath(parsed.locale, purseRoute), kind: "purse_payment" }
          : { id: result.proposal.id, href: localizedPath(parsed.locale, dashboardRoutes.approvals), kind: "proposal" },
    questionsLeft: questionsLeft(context.questions, context.userId, now()),
  };
}
