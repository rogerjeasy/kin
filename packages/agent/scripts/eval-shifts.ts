// The fixed evaluation set for the shift-wording prompt (AGENTS.md section 7).
// Runs every case against the configured model through the real guard and
// writes the results to evals/results. Calls the real model, so it costs money:
//   KIN_BEDROCK_REGION=us-east-1 AWS_PROFILE=... pnpm --filter @kin/agent run eval:shifts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { readModelConfig } from "@kin/config";

import { bedrockModel } from "../src/bedrock-model.ts";
import { wordCoverNote, wordShiftQuestion, type CoverNoteFacts, type ShiftQuestionFacts, type ShiftWording } from "../src/shift-words.ts";
import { SHIFT_WORDS_PROMPT_VERSION } from "../src/shift-words-prompt.ts";

type Case = {
  name: string;
  kind: "question" | "cover";
  facts: ShiftQuestionFacts | CoverNoteFacts;
  /** "model": the model must have worded it. "safe": the fixed wording is as good, but nothing excluded may reach the person. */
  expect: "model" | "safe";
  include: string[];
  exclude: string[];
  script?: "arabic" | "hebrew";
  /** No digit may be written at all: the facts held no number. */
  noDigits?: boolean;
};

const SCRIPTS = { arabic: /\p{Script=Arabic}/u, hebrew: /\p{Script=Hebrew}/u } as const;

const suite = JSON.parse(readFileSync(new URL("../evals/shift-words.json", import.meta.url), "utf8")) as { cases: Case[] };
const config = readModelConfig(process.env);
if (!config.enabled) throw new Error("Set KIN_BEDROCK_REGION (and AWS credentials) to run the evaluation");
const model = bedrockModel(config);

function problemsOf(each: Case, wording: ShiftWording | null): string[] {
  if (wording === null) return ["no wording at all"];
  const problems: string[] = [];
  if (each.expect === "model" && wording.source !== "model") problems.push(`fell back to the fixed wording (${wording.provenance.source === "template" ? wording.provenance.reason : "?"})`);
  for (const text of each.include) if (!wording.text.includes(text)) problems.push(`lacks "${text}"`);
  for (const text of each.exclude) if (wording.text.toLowerCase().includes(text.toLowerCase())) problems.push(`holds "${text}"`);
  if (each.noDigits === true && /\d/u.test(wording.text)) problems.push("holds a digit the facts did not give");
  if (each.script !== undefined && wording.source === "model" && !SCRIPTS[each.script].test(wording.text)) problems.push(`is not written in ${each.script}`);
  return problems;
}

const results = [];
for (const each of suite.cases) {
  const wording = each.kind === "question" ? await wordShiftQuestion(model, each.facts as ShiftQuestionFacts) : await wordCoverNote(model, each.facts as CoverNoteFacts);
  const problems = problemsOf(each, wording);
  const passed = problems.length === 0;
  results.push({ name: each.name, kind: each.kind, language: each.facts.language, expect: each.expect, passed, problems, text: wording?.text ?? null, source: wording?.source ?? null });
  console.log(`${passed ? "pass" : "FAIL"}  ${each.name}${passed ? "" : `: ${problems.join("; ")}`}`);
}

const passedCount = results.filter((each) => each.passed).length;
const modelCount = results.filter((each) => each.source === "model").length;
const day = new Date().toISOString().slice(0, 10);
mkdirSync(new URL("../evals/results/", import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../evals/results/shifts-${day}.json`, import.meta.url),
  `${JSON.stringify({ date: day, prompt: SHIFT_WORDS_PROMPT_VERSION, model: config.model, api: config.api, passed: passedCount, total: results.length, workedByModel: modelCount, cases: results }, null, 2)}\n`,
);
console.log(`${SHIFT_WORDS_PROMPT_VERSION} on ${config.model}: ${passedCount}/${results.length} passed, ${modelCount} worded by the model`);
process.exitCode = passedCount === results.length ? 0 : 1;
