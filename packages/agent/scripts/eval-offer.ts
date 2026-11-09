// The fixed evaluation set for the sealed-offer prompt (AGENTS.md section 7).
// Runs every case against the configured model and compares the draft offer
// read with the expected one, exactly. Calls the real model, so it costs money:
//   KIN_BEDROCK_REGION=us-east-1 AWS_PROFILE=... pnpm --filter @kin/agent run eval:offer
import { readFileSync } from "node:fs";

import { readModelConfig } from "@kin/config";

import { bedrockModel } from "../src/bedrock-model.ts";
import { readOffer } from "../src/read-offer.ts";
import { SEALED_OFFER_PROMPT_VERSION } from "../src/sealed-offer-prompt.ts";

type Case = {
  name: string;
  language: string;
  words: string[];
  monthlyCents: number | null;
  stepUp: { cents: number; fromMonth: string } | null;
  earliestMonth: string | null;
  careTrips: number;
  careMinutes: number;
};

const suite = JSON.parse(readFileSync(new URL("../evals/sealed-offer.json", import.meta.url), "utf8")) as { startMonth: string; currency: string; cases: Case[] };
const config = readModelConfig(process.env);
if (!config.enabled) throw new Error("Set KIN_BEDROCK_REGION (and AWS credentials) to run the evaluation");
const model = bedrockModel(config);

let failed = 0;
for (const each of suite.cases) {
  const result = await readOffer(model, each.words, { startMonth: suite.startMonth, currency: suite.currency, language: each.language });
  const got = result.kind === "draft" ? result.draft : result.kind;
  const expected = { monthlyCents: each.monthlyCents, stepUp: each.stepUp, earliestMonth: each.earliestMonth, careTrips: each.careTrips, careMinutes: each.careMinutes };
  const passed = JSON.stringify(got) === JSON.stringify(expected);
  if (!passed) failed += 1;
  console.log(`${passed ? "pass" : "FAIL"}  ${each.name}${passed ? "" : `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`}`);
}
console.log(`${SEALED_OFFER_PROMPT_VERSION} on ${config.model}: ${suite.cases.length - failed}/${suite.cases.length} passed`);
process.exitCode = failed === 0 ? 0 : 1;
