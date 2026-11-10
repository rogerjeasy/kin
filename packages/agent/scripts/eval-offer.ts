// The fixed evaluation set for the sealed-offer prompt (AGENTS.md section 7).
// Runs every case against the configured model and compares the draft offer
// read with the expected one by what it gives: the same care, and the same
// money in each of the next 24 months (offerInMonth), however the model chose to
// say it ("$100 a month from January" or "a step up to $100 from January").
// Calls the real model, so it costs money:
//   KIN_BEDROCK_REGION=us-east-1 AWS_PROFILE=... pnpm --filter @kin/agent run eval:offer
import { readFileSync } from "node:fs";

import { readModelConfig } from "@kin/config";
import { addMonths, offerInMonth, type Month } from "@kin/domain";

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
  const passed = typeof got === "object" && givesTheSame(got, expected, suite.startMonth as Month);
  if (!passed) failed += 1;
  console.log(`${passed ? "pass" : "FAIL"}  ${each.name}${passed ? "" : `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`}`);
}
console.log(`${SEALED_OFFER_PROMPT_VERSION} on ${config.model}: ${suite.cases.length - failed}/${suite.cases.length} passed`);
process.exitCode = failed === 0 ? 0 : 1;

type Draft = { monthlyCents: number | null; stepUp: { cents: number; fromMonth: string } | null; earliestMonth: string | null; careTrips: number; careMinutes: number };

/** The same care, and the same money in each of the next 24 months, as the screen would seal it. */
function givesTheSame(got: Draft, expected: Draft, start: Month): boolean {
  if (got.careTrips !== expected.careTrips || got.careMinutes !== expected.careMinutes) return false;
  const sealed = (draft: Draft) => ({ memberId: "eval", monthlyCents: draft.monthlyCents ?? 0, stepUp: draft.stepUp === null ? null : { cents: draft.stepUp.cents, fromMonth: draft.stepUp.fromMonth as Month }, careTrips: draft.careTrips, careMinutes: draft.careMinutes, earliestMonth: draft.earliestMonth as Month | null, takesShortfall: false });
  return Array.from({ length: 24 }, (_, index) => addMonths(start, index)).every((month) => offerInMonth(sealed(got), month) === offerInMonth(sealed(expected), month));
}
