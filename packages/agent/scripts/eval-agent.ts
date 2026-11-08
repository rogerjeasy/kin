// The fixed evaluation set for Ask Kin (AGENTS.md section 7). Runs every case
// against the configured model through the real tool gateway, with the tools
// answering from a fixed record, and writes the results to evals/results.
// Calls the real model, so it costs money:
//   KIN_BEDROCK_REGION=us-east-1 KIN_BEDROCK_API=invoke AWS_PROFILE=... pnpm --filter @kin/agent run eval:agent
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { readModelConfig } from "@kin/config";
import type { CircleRole } from "@kin/domain";

import { askKin } from "../src/ask-kin/ask-kin.ts";
import { ASK_KIN_PROMPT_VERSION } from "../src/ask-kin/ask-kin-prompt.ts";
import { ASK_KIN_TOOL_NAMES, type AskKinToolName } from "../src/ask-kin/ask-kin-tools.ts";
import { bedrockToolModel } from "../src/ask-kin/bedrock-tool-model.ts";
import { toolGateway, type ToolImplementations, type ToolOutput } from "../src/ask-kin/tool-gateway.ts";

type Case = {
  name: string;
  role: CircleRole;
  language: string;
  question: string;
  /** Tools the model must have run. */
  must?: AskKinToolName[];
  /** Tools that must never have run. A refused attempt is not a run. */
  mustNot?: AskKinToolName[];
  proposal?: boolean;
  /** The list_bills result carries injected instructions. */
  injected?: boolean;
  include?: string[];
  exclude?: string[];
  match?: string;
};
type Suite = { record: Record<AskKinToolName, ToolOutput>; injectedBills: ToolOutput; cases: Case[] };

const suite = JSON.parse(readFileSync(new URL("../evals/agent.json", import.meta.url), "utf8")) as Suite;
const config = readModelConfig(process.env);
if (!config.enabled) throw new Error("Set KIN_BEDROCK_REGION (and AWS credentials) to run the evaluation");
const model = bedrockToolModel(config);

function implementations(injected: boolean): ToolImplementations {
  const answer = (name: AskKinToolName) => async (args: { readonly limit?: number }) => {
    if (injected && name === "list_bills") return suite.injectedBills;
    if (name !== "get_record") return suite.record[name];
    // The record tool honours its limit and counts what it returns, as the app's does.
    const { entries } = suite.record.get_record.data as { entries: unknown[] };
    const shown = entries.slice(0, args.limit ?? 6);
    return { ...suite.record.get_record, data: { entries: shown, count: shown.length } } as ToolOutput;
  };
  return Object.fromEntries(ASK_KIN_TOOL_NAMES.map((name) => [name, answer(name)])) as unknown as ToolImplementations;
}

const results = [];
for (const each of suite.cases) {
  const gateway = toolGateway({ context: { circleId: "eval-circle", memberId: "eval-member", role: each.role }, implementations: implementations(each.injected === true), recorder: () => undefined, clock: Date.now });
  const result = await askKin(model, { question: each.question, history: [], language: each.language, gateway, template: (facts) => `Here is what the record says: ${facts.join(" ")}` });
  const problems: string[] = [];
  if (result.kind === "unavailable") problems.push("the model was unavailable");
  else {
    const ran = result.calls.filter((call) => call.outcome === "ok").map((call) => call.tool);
    for (const tool of each.must ?? []) if (!ran.includes(tool)) problems.push(`did not run ${tool}`);
    for (const tool of each.mustNot ?? []) if (ran.includes(tool)) problems.push(`ran ${tool}`);
    if ((result.proposal !== null) !== (each.proposal === true)) problems.push(result.proposal === null ? "raised no proposal" : "raised a proposal");
    if (result.source !== "claude") problems.push(`fell back to the template (${result.templateReason ?? ""})`);
    for (const text of each.include ?? []) if (!result.text.includes(text)) problems.push(`answer lacks "${text}"`);
    for (const text of each.exclude ?? []) if (result.text.includes(text)) problems.push(`answer holds "${text}"`);
    if (each.match !== undefined && !new RegExp(each.match, "iu").test(result.text)) problems.push(`answer does not match /${each.match}/`);
  }
  const passed = problems.length === 0;
  results.push({ name: each.name, role: each.role, question: each.question, passed, problems, ...(result.kind === "answered" ? { answer: result.text, source: result.source, calls: result.calls, proposal: result.proposal !== null } : {}) });
  console.log(`${passed ? "pass" : "FAIL"}  ${each.name}${passed ? "" : `: ${problems.join("; ")}`}`);
}

const passedCount = results.filter((each) => each.passed).length;
const day = new Date().toISOString().slice(0, 10);
mkdirSync(new URL("../evals/results/", import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../evals/results/agent-${day}.json`, import.meta.url),
  `${JSON.stringify({ date: day, prompt: ASK_KIN_PROMPT_VERSION, model: config.model, api: config.api, passed: passedCount, total: results.length, cases: results }, null, 2)}\n`,
);
console.log(`${ASK_KIN_PROMPT_VERSION} on ${config.model}: ${passedCount}/${results.length} passed`);
process.exitCode = passedCount === results.length ? 0 : 1;
