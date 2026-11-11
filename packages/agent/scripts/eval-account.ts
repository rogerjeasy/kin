// The fixed evaluation set for the account-reading prompt (AGENTS.md section 7).
// Runs every case against the configured model and compares the three fields read
// with the expected ones, exactly. Calls the real model, so it costs money:
//   KIN_BEDROCK_REGION=us-east-1 AWS_PROFILE=... pnpm --filter @kin/agent run eval:account
import { readFileSync } from "node:fs";

import { readModelConfig } from "@kin/config";

import { ACCOUNT_PROMPT_VERSION } from "../src/account-prompt.ts";
import { bedrockModel } from "../src/bedrock-model.ts";
import { readAccount } from "../src/read-account.ts";
import { writeEvalResults } from "./eval-results.ts";

type Case = { name: string; account: string; claimedName: string | null; claimedRelationship: string | null; amountText: string | null };

const suite = JSON.parse(readFileSync(new URL("../evals/account.json", import.meta.url), "utf8")) as { cases: Case[] };
const config = readModelConfig(process.env);
if (!config.enabled) throw new Error("Set KIN_BEDROCK_REGION (and AWS credentials) to run the evaluation");
const model = bedrockModel(config);

const results = [];
for (const each of suite.cases) {
  const result = await readAccount(model, each.account);
  const got = result.kind === "fields" ? { claimedName: result.fields.claimedName, claimedRelationship: result.fields.claimedRelationship, amountText: result.fields.amountText } : result.kind;
  const expected = { claimedName: each.claimedName, claimedRelationship: each.claimedRelationship, amountText: each.amountText };
  const passed = JSON.stringify(got) === JSON.stringify(expected);
  results.push({ name: each.name, account: each.account, passed, expected, got });
  console.log(`${passed ? "pass" : "FAIL"}  ${each.name}${passed ? "" : `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`}`);
}
process.exitCode = writeEvalResults("account", { prompt: ACCOUNT_PROMPT_VERSION, model: config.model, api: config.api, cases: results });
