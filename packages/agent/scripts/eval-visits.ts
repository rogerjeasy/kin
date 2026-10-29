// The fixed evaluation set for the visit-reading prompt (AGENTS.md section 7).
// Runs every case against the configured model and compares the visits read
// with the expected ones, exactly. Calls the real model, so it costs money:
//   KIN_BEDROCK_REGION=us-east-1 AWS_PROFILE=... pnpm --filter @kin/agent run eval
import { readFileSync } from "node:fs";

import { readModelConfig } from "@kin/config";

import { bedrockModel } from "../src/bedrock-model.ts";
import { readVisits } from "../src/read-visits.ts";
import { VISIT_PROMPT_VERSION } from "../src/visit-prompt.ts";

type Case = { name: string; description: string; visits: [string, number][]; unclear?: boolean };
type Suite = { today: string; weekday: string; timezone: string; cases: Case[] };

const suite = JSON.parse(readFileSync(new URL("../evals/visits.json", import.meta.url), "utf8")) as Suite;
const config = readModelConfig(process.env);
if (!config.enabled) throw new Error("Set KIN_BEDROCK_REGION (and AWS credentials) to run the evaluation");
const model = bedrockModel(config);

let failed = 0;
for (const each of suite.cases) {
  const result = await readVisits(model, { description: each.description, today: suite.today, weekday: suite.weekday, timezone: suite.timezone });
  const got = result.kind === "visits" ? result.visits.map((visit) => [visit.date, visit.minutes]) : result.kind;
  const passed = JSON.stringify(got) === JSON.stringify(each.visits) && (each.unclear !== true || (result.kind === "visits" && result.unclear.length > 0));
  if (!passed) failed += 1;
  console.log(`${passed ? "pass" : "FAIL"}  ${each.name}${passed ? "" : `: expected ${JSON.stringify(each.visits)}, got ${JSON.stringify(got)}`}`);
}
console.log(`${VISIT_PROMPT_VERSION} on ${config.model}: ${suite.cases.length - failed}/${suite.cases.length} passed`);
process.exitCode = failed === 0 ? 0 : 1;
