// The fixed evaluation set for the wish-drafting prompt (AGENTS.md section 7).
// Runs every case against the configured model and compares the drafted wishes
// with the expected ones: each kind, trigger and record ID exactly, and every wish
// that cannot be a rule flagged (any reason), never guessed. Calls the real
// model, so it costs money:
//   KIN_BEDROCK_REGION=us-east-1 AWS_PROFILE=... pnpm --filter @kin/agent run eval:wishes
import { readFileSync } from "node:fs";

import { readModelConfig } from "@kin/config";

import { bedrockModel } from "../src/bedrock-model.ts";
import { draftWishes, type WishRecordNames } from "../src/draft-wishes.ts";
import { WISH_PROMPT_VERSION } from "../src/wish-prompt.ts";
import { writeEvalResults } from "./eval-results.ts";

type Expected = { kind: string; trigger?: string; [field: string]: unknown };
type Case = { name: string; said: string; locale?: string; expect: Expected[] };
type Suite = { record: Pick<WishRecordNames, "caregivers" | "members" | "subscriptions">; cases: Case[] };

const suite = JSON.parse(readFileSync(new URL("../evals/wishes.json", import.meta.url), "utf8")) as Suite;
const config = readModelConfig(process.env);
if (!config.enabled) throw new Error("Set KIN_BEDROCK_REGION (and AWS credentials) to run the evaluation");
const model = bedrockModel(config);

const record = (locale: string): WishRecordNames => ({
  ...suite.record,
  currency: "USD",
  locale,
  context: {
    members: [{ id: "rose", role: "parent", active: true }, ...suite.record.members.map((member, index) => ({ id: member.memberId, role: index === 0 ? ("organizer" as const) : ("contributor" as const), active: true }))],
    caregiverPayeeIds: suite.record.caregivers.map((each) => each.payeeId),
    subscriptionIds: suite.record.subscriptions.map((each) => each.id),
  },
});

/** The same text for the same wishes, whatever order their fields came in. */
const canonical = (wishes: readonly Record<string, unknown>[]): string => JSON.stringify(wishes.map((wish) => Object.fromEntries(Object.entries(wish).toSorted(([a], [b]) => a.localeCompare(b)))));

const results = [];
for (const each of suite.cases) {
  const result = await draftWishes(model, each.said, record(each.locale ?? "en"));
  const got = result.kind === "drafts" ? result.wishes.map((wish) => (wish.kind === "flagged" ? { kind: "flagged" } : { ...wish.draft.rule, trigger: wish.draft.trigger })) : [{ kind: result.kind }];
  const expected = each.expect.map((wish) => (wish.kind === "flagged" ? { kind: "flagged" } : wish));
  const passed = canonical(got) === canonical(expected);
  results.push({ name: each.name, said: each.said, locale: each.locale ?? "en", passed, expected, got });
  console.log(`${passed ? "pass" : "FAIL"}  ${each.name}${passed ? "" : `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`}`);
}
process.exitCode = writeEvalResults("wishes", { prompt: WISH_PROMPT_VERSION, model: config.model, api: config.api, cases: results });
