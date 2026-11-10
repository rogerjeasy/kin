import { authorize } from "@kin/auth";
import type { CircleRole } from "@kin/domain";

import { ASK_KIN_TOOLS, ASK_KIN_TOOL_NAMES, isAskKinTool, type AskKinToolName } from "./ask-kin-tools.ts";
import type { ToolResultBlock, ToolSpec, ToolUse } from "./tool-model.ts";
import { parseArgs, type ArgsOf, type ToolArgs } from "./tool-schema.ts";

/**
 * The tool gateway (docs/architecture.md section 9.3). Every call the model
 * asks for passes here: the tool must exist and be one the person's role may
 * use, its arguments must follow its schema, it runs within a time and size
 * limit, and the call is recorded, whatever its outcome. The model only ever
 * sees a short result or a short reason; never an exception's text.
 */

/**
 * Who is asking, resolved by the caller from the verified session, never from the model. `question` is the person's
 * own words for this turn, as they sent them: a tool that must read them (the Purse scans them for signs of pressure)
 * takes them from here, never from arguments the model could leave out.
 */
export type ToolContext = { readonly circleId: string; readonly memberId: string; readonly role: CircleRole; readonly question?: string };

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** What a tool found. */
export type ToolOutput = {
  /** What the model reads: already formatted for the listener, amounts as the screens print them. */
  readonly data: JsonValue;
  /** The same finding as one fixed sentence in the listener's language, for the template answer. */
  readonly fact: string;
  /** A proposal the tool raised, which still waits for the family's yes, or, for a payment from her Purse, for the parent's own. */
  readonly proposal?: RaisedProposal;
};

/** A proposal a tool raised. `purse_payment` is one from the parent's Purse, answered on her Purse screen, not on Approvals. */
export type RaisedProposal = { readonly id: string; readonly kind?: "purse_payment" };

export type ToolImplementation<N extends AskKinToolName> = (args: ArgsOf<(typeof ASK_KIN_TOOLS)[N]["inputSchema"]>, context: ToolContext) => Promise<ToolOutput>;

/** The web app's implementations, one per tool, reading as the person so row-level security still applies. */
export type ToolImplementations = { readonly [N in AskKinToolName]: ToolImplementation<N> };

export type ToolOutcome = "ok" | "unknown_tool" | "refused" | "invalid" | "limit" | "failed" | "timeout" | "too_large";

export type ToolCallRecord = {
  readonly tool: string;
  /** The arguments with free text masked: enumerations and numbers stay readable. */
  readonly args: Readonly<Record<string, string | number>>;
  readonly outcome: ToolOutcome;
  readonly durationMs: number;
  readonly at: Date;
};

export type ToolRecorder = (record: ToolCallRecord, context: ToolContext) => void;

export type GatewayLimits = {
  /** Tool calls per question, of any kind. */
  readonly maxCalls: number;
  /** Proposals per question. */
  readonly maxProposals: number;
  readonly timeoutMs: number;
  /** The longest result, in characters, handed back to the model. */
  readonly maxResultChars: number;
};

export const DEFAULT_LIMITS: GatewayLimits = { maxCalls: 6, maxProposals: 1, timeoutMs: 8_000, maxResultChars: 6_000 };

export type GatewayCall = { readonly block: ToolResultBlock; readonly record: ToolCallRecord; readonly output: ToolOutput | null };

export type ToolGateway = {
  /** The tools this person's role may use, as the model is shown them. Nothing else is offered. */
  readonly tools: readonly ToolSpec[];
  readonly call: (use: ToolUse) => Promise<GatewayCall>;
};

/** Whether `role` may use the tool, decided by the one authorization function. */
export function mayUseTool(role: CircleRole, name: AskKinToolName): boolean {
  return authorize({ role, status: "active" }, ASK_KIN_TOOLS[name].action).allowed;
}

/** The tools offered to a role, in the catalogue's order. */
export function toolsForRole(role: CircleRole): ToolSpec[] {
  return ASK_KIN_TOOL_NAMES.filter((name) => mayUseTool(role, name)).map((name) => ({ name, description: ASK_KIN_TOOLS[name].description, inputSchema: ASK_KIN_TOOLS[name].inputSchema }));
}

const REASONS: Record<Exclude<ToolOutcome, "ok">, string> = {
  unknown_tool: "There is no such tool.",
  refused: "This tool is not available to this person's role in the circle. Say that Kin cannot show that from their seat.",
  invalid: "The arguments did not follow the tool's schema. Nothing was run.",
  limit: "The limit of tool calls for this question is reached. Answer with what you already have.",
  failed: "The tool could not read the record just now. Say so; do not guess.",
  timeout: "The tool did not answer in time, so its outcome is unknown. Do not call it again; say the outcome is not known yet.",
  too_large: "The result was too large to hand back. Answer with what you already have.",
};

/** Keeps what an operator needs from the arguments and masks what a person typed. */
export function maskArgs(name: AskKinToolName, args: unknown): Record<string, string | number> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return {};
  const properties: Readonly<Record<string, { readonly type: string; readonly enum?: readonly string[] }>> = ASK_KIN_TOOLS[name].inputSchema.properties;
  return Object.fromEntries(
    Object.entries(args).flatMap(([key, value]: [string, unknown]): [string, string | number][] => {
      const property = properties[key];
      if (property === undefined) return [[key, "[unexpected]"]];
      if (typeof value === "number") return [[key, value]];
      if (typeof value === "string" && property.enum?.includes(value) === true) return [[key, value]];
      return [[key, `[text:${typeof value === "string" ? value.length : typeof value}]`]];
    }),
  );
}

class TimedOut extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimedOut()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

type RunOutcome = { readonly outcome: ToolOutcome; readonly output: ToolOutput | null; readonly content: string };

/**
 * A gateway for one question, from one person in one circle. Its counters
 * live as long as the question does.
 */
export function toolGateway(options: {
  readonly context: ToolContext;
  readonly implementations: ToolImplementations;
  readonly recorder: ToolRecorder;
  readonly clock: () => number;
  readonly limits?: GatewayLimits;
}): ToolGateway {
  const { context, implementations, recorder, clock } = options;
  const limits = options.limits ?? DEFAULT_LIMITS;
  let calls = 0;
  let proposals = 0;

  const refuse = (outcome: Exclude<ToolOutcome, "ok">): RunOutcome => ({ outcome, output: null, content: REASONS[outcome] });

  async function run(name: AskKinToolName, args: ToolArgs): Promise<RunOutcome> {
    const implementation = implementations[name] as (args: ToolArgs, context: ToolContext) => Promise<ToolOutput>; // The arguments were parsed against this tool's own schema.
    let output: ToolOutput;
    try {
      output = await withTimeout(implementation(args, context), limits.timeoutMs);
    } catch (error) {
      return refuse(error instanceof TimedOut ? "timeout" : "failed");
    }
    const content = JSON.stringify(output.data);
    if (content.length > limits.maxResultChars) return refuse("too_large");
    return { outcome: "ok", output, content };
  }

  async function decide(use: ToolUse): Promise<RunOutcome> {
    if (!isAskKinTool(use.name)) return refuse("unknown_tool");
    if (!mayUseTool(context.role, use.name)) return refuse("refused");
    if (calls >= limits.maxCalls) return refuse("limit");
    const definition = ASK_KIN_TOOLS[use.name];
    if (definition.kind === "propose" && proposals >= limits.maxProposals) return refuse("limit");
    const args = parseArgs(definition.inputSchema, use.input);
    if (args === null) return refuse("invalid");
    calls += 1;
    if (definition.kind === "propose") proposals += 1;
    return run(use.name, args);
  }

  return {
    tools: toolsForRole(context.role),
    async call(use) {
      const started = clock();
      const result = await decide(use);
      const record: ToolCallRecord = {
        tool: isAskKinTool(use.name) ? use.name : "[unknown]",
        args: isAskKinTool(use.name) ? maskArgs(use.name, use.input) : {},
        outcome: result.outcome,
        durationMs: Math.max(0, clock() - started),
        at: new Date(started),
      };
      recorder(record, context);
      const block: ToolResultBlock = result.outcome === "ok" ? { type: "tool_result", tool_use_id: use.id, content: result.content } : { type: "tool_result", tool_use_id: use.id, content: result.content, is_error: true };
      return { block, record, output: result.output };
    },
  };
}
