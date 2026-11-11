// The fixed evaluation set for Ask Kin (AGENTS.md section 7). Runs every case
// against the configured model through the real tool gateway, with the tools
// answering from a fixed record, and writes the results, with each case's full
// tool trace, to evals/results.
// Calls the real model, so it costs money:
//   KIN_BEDROCK_REGION=us-east-1 KIN_BEDROCK_API=invoke AWS_PROFILE=... pnpm --filter @kin/agent run eval:agent
import { readFileSync } from "node:fs";

import { readModelConfig } from "@kin/config";
import type { CircleRole } from "@kin/domain";

import { askKin } from "../src/ask-kin/ask-kin.ts";
import { ASK_KIN_PROMPT_VERSION } from "../src/ask-kin/ask-kin-prompt.ts";
import { ASK_KIN_TOOL_NAMES, type AskKinToolName } from "../src/ask-kin/ask-kin-tools.ts";
import { bedrockToolModel } from "../src/ask-kin/bedrock-tool-model.ts";
import { toolGateway, type ToolCallRecord, type ToolImplementations, type ToolOutput } from "../src/ask-kin/tool-gateway.ts";
import { writeEvalResults } from "./eval-results.ts";

type Case = {
  name: string;
  role: CircleRole;
  language: string;
  question: string;
  /** Tools the model must have run. */
  must?: AskKinToolName[];
  /** Tools that must never have run. A refused attempt is not a run. */
  mustNot?: AskKinToolName[];
  /** The least number of different tools that must have run: a multi-step case needs two or more. */
  minTools?: number;
  proposal?: boolean;
  /** Tools whose result carries injected instructions. */
  injected?: AskKinToolName[];
  include?: string[];
  exclude?: string[];
  match?: string;
};
type Suite = { record: Record<AskKinToolName, ToolOutput>; injected: Partial<Record<AskKinToolName, ToolOutput>>; claims: Record<string, ToolOutput>; cases: Case[] };

/** One step of a case's trace: what the gateway recorded, and for a call that ran, the arguments the tool received. */
type TraceStep = Pick<ToolCallRecord, "tool" | "outcome" | "durationMs"> & { readonly args: ToolCallRecord["args"]; readonly input?: unknown };

const suite = JSON.parse(readFileSync(new URL("../evals/agent.json", import.meta.url), "utf8")) as Suite;
const config = readModelConfig(process.env);
if (!config.enabled) throw new Error("Set KIN_BEDROCK_REGION (and AWS credentials) to run the evaluation");
const model = bedrockToolModel(config);

/** The fixed record's tools. Each call's arguments are kept, in order, for the trace. */
function implementations(injected: readonly AskKinToolName[], inputs: unknown[]): ToolImplementations {
  const answer = (name: AskKinToolName) => async (args: { readonly limit?: number; readonly payee?: string }) => {
    inputs.push(args);
    const swapped = injected.includes(name) ? suite.injected[name] : undefined;
    if (swapped !== undefined) return swapped;
    if (name === "check_claim") return suite.claims[(args.payee ?? "").trim().toLowerCase()] ?? suite.record.check_claim;
    if (name !== "get_record") return suite.record[name];
    // The record tool honours its limit and counts what it returns, as the app's does.
    const { entries } = suite.record.get_record.data as { entries: unknown[] };
    const shown = entries.slice(0, args.limit ?? 6);
    return { ...suite.record.get_record, data: { entries: shown, count: shown.length } } as ToolOutput;
  };
  return Object.fromEntries(ASK_KIN_TOOL_NAMES.map((name) => [name, answer(name)])) as unknown as ToolImplementations;
}

/** The gateway's records, in the order the calls were made, each that ran with the arguments its tool received. */
function trace(records: readonly ToolCallRecord[], inputs: readonly unknown[]): TraceStep[] {
  let ran = 0;
  return records.map((record) => {
    const step = { tool: record.tool, outcome: record.outcome, durationMs: record.durationMs, args: record.args };
    return record.outcome === "ok" || record.outcome === "timeout" || record.outcome === "failed" || record.outcome === "too_large" ? { ...step, input: inputs[ran++] } : step;
  });
}

const results = [];
for (const each of suite.cases) {
  const records: ToolCallRecord[] = [];
  const inputs: unknown[] = [];
  const gateway = toolGateway({ context: { circleId: "eval-circle", memberId: "eval-member", role: each.role }, implementations: implementations(each.injected ?? [], inputs), recorder: (record) => records.push(record), clock: Date.now });
  const started = Date.now();
  const result = await askKin(model, { question: each.question, history: [], language: each.language, gateway, template: (facts) => `Here is what the record says: ${facts.join(" ")}` });
  const problems: string[] = [];
  if (result.kind === "unavailable") problems.push("the model was unavailable");
  else {
    const ran = result.calls.filter((call) => call.outcome === "ok").map((call) => call.tool);
    for (const tool of each.must ?? []) if (!ran.includes(tool)) problems.push(`did not run ${tool}`);
    for (const tool of each.mustNot ?? []) if (ran.includes(tool)) problems.push(`ran ${tool}`);
    if (each.minTools !== undefined && new Set(ran).size < each.minTools) problems.push(`ran ${new Set(ran).size} different tools, fewer than ${each.minTools}`);
    if ((result.proposal !== null) !== (each.proposal === true)) problems.push(result.proposal === null ? "raised no proposal" : "raised a proposal");
    if (result.source !== "claude") problems.push(`fell back to the template (${result.templateReason ?? ""})`);
    for (const text of each.include ?? []) if (!result.text.includes(text)) problems.push(`answer lacks "${text}"`);
    for (const text of each.exclude ?? []) if (result.text.includes(text)) problems.push(`answer holds "${text}"`);
    if (each.match !== undefined && !new RegExp(each.match, "iu").test(result.text)) problems.push(`answer does not match /${each.match}/`);
  }
  const passed = problems.length === 0;
  results.push({
    name: each.name,
    role: each.role,
    question: each.question,
    passed,
    problems,
    durationMs: Date.now() - started,
    trace: trace(records, inputs),
    ...(result.kind === "answered" ? { answer: result.text, source: result.source, templateReason: result.templateReason, calls: result.calls, proposal: result.proposal !== null } : {}),
  });
  console.log(`${passed ? "pass" : "FAIL"}  ${each.name}${passed ? "" : `: ${problems.join("; ")}`}`);
}

process.exitCode = writeEvalResults("agent", { prompt: ASK_KIN_PROMPT_VERSION, model: config.model, api: config.api, cases: results });
