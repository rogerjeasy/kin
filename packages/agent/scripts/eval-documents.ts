// The fixed evaluation set for the document-reading prompt (AGENTS.md section 7).
// Runs every case against the configured model and compares the fields it
// read with the expected ones, exactly. Calls the real model, so it costs money:
//   KIN_BEDROCK_REGION=us-east-1 AWS_PROFILE=... pnpm --filter @kin/agent run eval:documents
import { readFileSync } from "node:fs";

import { readModelConfig } from "@kin/config";

import { bedrockModel } from "../src/bedrock-model.ts";
import { DOCUMENT_PROMPT_VERSION } from "../src/document-prompt.ts";
import { readDocument } from "../src/read-document.ts";

type Expect = { kind: string; sender: string | null; amount: string | null; dueOn: string | null; pressure: boolean };
type Suite = { today: string; currency: string; cases: { name: string; text: string; expect: Expect }[] };

const suite = JSON.parse(readFileSync(new URL("../evals/documents.json", import.meta.url), "utf8")) as Suite;
const config = readModelConfig(process.env);
if (!config.enabled) throw new Error("Set KIN_BEDROCK_REGION (and AWS credentials) to run the evaluation");
const model = bedrockModel(config);

let failed = 0;
for (const each of suite.cases) {
  const result = await readDocument(model, { text: each.text, image: null, today: suite.today, currency: suite.currency });
  const got = result.kind === "read" ? { kind: result.reading.kind, sender: result.reading.sender, amount: result.reading.amount, dueOn: result.reading.dueOn, pressure: result.reading.pressure } : result.kind;
  const passed = JSON.stringify(got) === JSON.stringify(each.expect);
  if (!passed) failed += 1;
  console.log(`${passed ? "pass" : "FAIL"}  ${each.name}${passed ? "" : `: expected ${JSON.stringify(each.expect)}, got ${JSON.stringify(got)}`}`);
}
console.log(`${DOCUMENT_PROMPT_VERSION} on ${config.model}: ${suite.cases.length - failed}/${suite.cases.length} passed`);
process.exitCode = failed === 0 ? 0 : 1;
