// The fixed evaluation set for the Purse's gift-reading prompt (AGENTS.md section 7).
// Runs every case against the configured model and compares the five fields read
// with the expected ones, exactly. Calls the real model, so it costs money:
//   KIN_BEDROCK_REGION=us-east-1 AWS_PROFILE=... pnpm --filter @kin/agent run eval:gift
import { readFileSync } from "node:fs";

import { readModelConfig } from "@kin/config";

import { bedrockModel } from "../src/bedrock-model.ts";
import { GIFT_PROMPT_VERSION } from "../src/gift-prompt.ts";
import { readGift } from "../src/read-gift.ts";
import { writeEvalResults } from "./eval-results.ts";

type Case = { name: string; words: string; payeeName: string | null; relationship: string | null; amountText: string | null; memo: string | null; route: string };

const suite = JSON.parse(readFileSync(new URL("../evals/gift.json", import.meta.url), "utf8")) as { cases: Case[] };
const config = readModelConfig(process.env);
if (!config.enabled) throw new Error("Set KIN_BEDROCK_REGION (and AWS credentials) to run the evaluation");
const model = bedrockModel(config);

const results = [];
for (const each of suite.cases) {
  const result = await readGift(model, each.words);
  const got = result.kind === "fields" ? result.fields : result.kind;
  const expected = { payeeName: each.payeeName, relationship: each.relationship, amountText: each.amountText, memo: each.memo, route: each.route };
  const passed = JSON.stringify(got) === JSON.stringify(expected);
  results.push({ name: each.name, words: each.words, passed, expected, got });
  console.log(`${passed ? "pass" : "FAIL"}  ${each.name}${passed ? "" : `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`}`);
}
process.exitCode = writeEvalResults("gift", { prompt: GIFT_PROMPT_VERSION, model: config.model, api: config.api, cases: results });
